// @vitest-environment jsdom
import type {
  DirectionsResponse,
  GeoFix,
  HeadingFix,
  HeadingSource,
  PositionSource,
  Route,
} from '@mapslibvn/core';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../core/tests/fixtures/directions-q1.json';
import type { MapHandle } from './context';
import { MapsLibVNMap, type MapsLibVNMapProps } from './map';
import { fakeSession, progressAt } from './test/fake-session';
import { getLastMapProps, resetMocks } from './test/mlrn-mock';
import { USER_LOCATION_LAYER_IDS, USER_LOCATION_SOURCE_ID } from './user-location/layers';
import { USER_LOCATION_CONE_TEST_ID, USER_LOCATION_PUCK_TEST_ID } from './user-location/puck';

vi.mock('react-native', () => import('./test/react-native-mock'));
vi.mock('@maplibre/maplibre-react-native', () => import('./test/mlrn-mock'));

const response = fixture as unknown as DirectionsResponse;
const route = response.routes[0] as Route;
const base = { apiKey: 'mlv_live_k', apiBase: 'https://api.test' };
const T0 = 1_700_000_000_000;
const fix: GeoFix = { lng: 106.7, lat: 10.78, accuracy_m: 12, timestamp: T0 };
const hd: HeadingFix = { heading: 90, accuracy: 'high', timestamp: T0, source: 'compass' };

function fakeSources() {
  let onFix: ((f: GeoFix) => void) | null = null;
  let onHeading: ((h: HeadingFix) => void) | null = null;
  const offFix = vi.fn();
  const offHeading = vi.fn();
  const source: PositionSource = {
    subscribe: vi.fn((cb: (f: GeoFix) => void) => {
      onFix = cb;
      return offFix;
    }),
  };
  const heading: HeadingSource = {
    subscribe: vi.fn((cb: (h: HeadingFix) => void) => {
      onHeading = cb;
      return offHeading;
    }),
  };
  return {
    source,
    heading,
    offFix,
    offHeading,
    pushFix: (f: GeoFix) => onFix?.(f),
    pushHeading: (h: HeadingFix) => onHeading?.(h),
  };
}
type MapProps = {
  onDidFinishLoadingStyle: () => void;
  onRegionWillChange: (e: { nativeEvent: { userInteraction: boolean } }) => void;
};
const mapProps = () => getLastMapProps() as unknown as MapProps;
function mount(props: Omit<MapsLibVNMapProps, 'apiKey' | 'apiBase'>) {
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
});

describe('<MapsLibVNMap userLocation>', () => {
  it('không prop: handle.userLocation có sẵn, fix null, following false, không có source chấm xanh', () => {
    const { handle } = mount({});
    expect(handle.userLocation.fix).toBeNull();
    expect(handle.userLocation.following).toBe(false);
    expect(screen.queryByTestId(`mlrn-source-${USER_LOCATION_SOURCE_ID}`)).toBeNull();
  });

  it('có prop: đăng ký nguồn, vẽ lớp khi có fix, nón khi có heading, handle đọc được', () => {
    const s = fakeSources();
    const { handle } = mount({ userLocation: { source: s.source, heading: s.heading } });
    expect(s.source.subscribe).toHaveBeenCalledTimes(1);
    act(() => s.pushFix(fix));
    expect(screen.getByTestId(`mlrn-source-${USER_LOCATION_SOURCE_ID}`)).toBeTruthy();
    expect(screen.getByTestId(`mlrn-layer-${USER_LOCATION_LAYER_IDS.accuracy}`)).toBeTruthy();
    expect(screen.getByTestId(USER_LOCATION_PUCK_TEST_ID)).toBeTruthy(); // chấm native trong Marker
    expect(screen.queryByTestId(USER_LOCATION_CONE_TEST_ID)).toBeNull();
    act(() => s.pushHeading(hd));
    expect(screen.getByTestId(USER_LOCATION_CONE_TEST_ID)).toBeTruthy(); // nón native, không phải layer
    expect(handle.userLocation.fix).toEqual(fix);
    expect(handle.userLocation.heading).toEqual(hd);
  });

  it('kéo bản đồ → following false; recenter → true; dẫn đường có tiến độ → ẩn và huỷ nguồn', () => {
    const s = fakeSources();
    const nav = fakeSession({ response });
    const { handle, rerender } = mount({ userLocation: { source: s.source, follow: 'center' } });
    act(() => s.pushFix(fix));
    expect(handle.userLocation.following).toBe(true);
    act(() => mapProps().onRegionWillChange({ nativeEvent: { userInteraction: true } }));
    expect(handle.userLocation.following).toBe(false);
    act(() => handle.userLocation.recenter());
    expect(handle.userLocation.following).toBe(true);
    rerender(
      <MapsLibVNMap
        {...base}
        userLocation={{ source: s.source, follow: 'center' }}
        navigation={nav.session}
      />,
    );
    act(() => nav.progress(progressAt(route, 5)));
    expect(screen.queryByTestId(`mlrn-source-${USER_LOCATION_SOURCE_ID}`)).toBeNull();
    expect(s.offFix).toHaveBeenCalledTimes(1);
    expect(handle.userLocation.fix).toBeNull();
  });
});
