// @vitest-environment jsdom
import type { DirectionsResponse, GeoFix, HeadingFix } from '@mapslibvn/core';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Animated } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../core/tests/fixtures/directions-q1.json';
import { createRoutesStore } from '../navigation/routes-store';
import { animatedTimingCalls } from '../test/react-native-mock';
import { USER_LOCATION_LAYER_IDS, USER_LOCATION_SOURCE_ID, UserLocationLayers } from './layers';
import { USER_LOCATION_CONE_TEST_ID, USER_LOCATION_PUCK_TEST_ID } from './puck';
import { createUserLocationStore } from './store';

vi.mock('react-native', () => import('../test/react-native-mock'));
vi.mock('@maplibre/maplibre-react-native', () => import('../test/mlrn-mock'));

const response = fixture as unknown as DirectionsResponse;
const T0 = 1_700_000_000_000;
const fix: GeoFix = { lng: 106.7, lat: 10.78, accuracy_m: 25, timestamp: T0 };
const heading = (h: number, ts: number, accuracy: HeadingFix['accuracy'] = 'high'): HeadingFix => ({
  heading: h,
  accuracy,
  timestamp: ts,
  source: 'fused',
});
const layer = (id: string) =>
  JSON.parse(screen.getByTestId(`mlrn-layer-${id}`).dataset.layer ?? '{}') as Record<
    string,
    unknown
  >;

beforeEach(() => {
  animatedTimingCalls.length = 0;
});
afterEach(cleanup);

function mount(opts: { accuracyCircle?: boolean; beforeId?: string | null } = {}) {
  const store = createUserLocationStore();
  const routes = createRoutesStore();
  const bearing = new Animated.Value(0);
  const el = (
    <UserLocationLayers
      store={store}
      routesStore={routes}
      accuracyCircle={opts.accuracyCircle ?? true}
      beforeId={opts.beforeId === undefined ? 'poi' : opts.beforeId}
      mapBearing={bearing}
    />
  );
  const r = render(el);
  return { store, routes, bearing, ...r, el };
}

describe('<UserLocationLayers>', () => {
  it('không fix → null; có fix → vòng sai số là layer, chấm + nón là Marker native tại fix', () => {
    const { store, container } = mount();
    expect(container.innerHTML).toBe('');
    act(() => store.setFix(fix));
    const src = screen.getByTestId(`mlrn-source-${USER_LOCATION_SOURCE_ID}`);
    const geo = JSON.parse(src.dataset.geojson ?? '{}') as {
      features: { geometry: { coordinates: number[] } }[];
    };
    expect(geo.features[0]?.geometry.coordinates).toEqual([106.7, 10.78]);
    const acc = layer(USER_LOCATION_LAYER_IDS.accuracy) as {
      paint: { 'circle-radius': unknown[] };
      beforeId: string;
    };
    expect(acc.paint['circle-radius'].slice(0, 3)).toEqual([
      'interpolate',
      ['exponential', 2],
      ['zoom'],
    ]);
    expect(acc.beforeId).toBe('poi');
    // Không còn layer symbol/circle cho nón/chấm — chúng là view native trong Marker
    expect(container.querySelectorAll('[data-testid^="mlrn-layer-"]')).toHaveLength(1);
    const marker = screen.getByTestId('mlrn-marker');
    expect(marker.dataset.lnglat).toBe('106.7,10.78');
    expect(marker.dataset.anchor).toBe('center');
    expect(screen.getByTestId(USER_LOCATION_PUCK_TEST_ID)).toBeTruthy();
    // chưa có hướng → không vẽ nón
    expect(screen.queryByTestId(USER_LOCATION_CONE_TEST_ID)).toBeNull();
  });

  it('hướng: nón hiện, mờ 0,45 khi unreliable; góc đi vào Animated.timing tuyến tính, không đổi GeoJSON', () => {
    const { store } = mount();
    act(() => store.setFix(fix));
    const before = screen.getByTestId(`mlrn-source-${USER_LOCATION_SOURCE_ID}`).dataset.geojson;
    act(() => store.setHeading(heading(350, T0)));
    expect(screen.getByTestId(USER_LOCATION_CONE_TEST_ID).dataset.opacity).toBe('1');
    expect(animatedTimingCalls).toEqual([]); // mẫu đầu: setValue thẳng, không tween
    act(() => store.setHeading(heading(10, T0 + 33)));
    // 350 → 10: đi +20° trên trục liên tục (370), thời lượng = khoảng cách hai lần phát
    expect(animatedTimingCalls).toEqual([{ toValue: 370, duration: 33 }]);
    act(() => store.setHeading(heading(10, T0 + 1033, 'unreliable')));
    expect(screen.getByTestId(USER_LOCATION_CONE_TEST_ID).dataset.opacity).toBe('0.45');
    expect(animatedTimingCalls.at(-1)).toEqual({ toValue: 370, duration: 250 }); // kẹp 250 ms
    // Source GeoJSON không đổi theo hướng → MapLibre không re-tile mỗi mẫu la bàn
    expect(screen.getByTestId(`mlrn-source-${USER_LOCATION_SOURCE_ID}`).dataset.geojson).toBe(
      before,
    );
  });

  it('accuracyCircle=false bỏ source + vòng, vẫn có Marker; dẫn đường có tiến độ → null', () => {
    const { store, routes, container, rerender, el } = mount({
      accuracyCircle: false,
      beforeId: null,
    });
    act(() => store.setFix(fix));
    expect(screen.queryByTestId(`mlrn-layer-${USER_LOCATION_LAYER_IDS.accuracy}`)).toBeNull();
    expect(screen.queryByTestId(`mlrn-source-${USER_LOCATION_SOURCE_ID}`)).toBeNull();
    expect(screen.getByTestId(USER_LOCATION_PUCK_TEST_ID)).toBeTruthy();
    act(() => {
      routes.show(response);
      routes.setProgress({ shapeIndex: 2, snapped: [106.69, 10.77], bearing: 0 });
    });
    rerender(el);
    expect(container.innerHTML).toBe('');
  });
});
