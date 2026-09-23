// @vitest-environment jsdom
import type { DirectionsResponse, FleetPlanResponse, MapsLibVNClient } from '@mapslibvn/core';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../core/tests/fixtures/directions-q1.json';
import fleetFixture from '../../../core/tests/fixtures/fleet-plan-q1.json';
import { MapContext, type MapHandle } from '../context';
import { getSourceProps, resetMocks } from '../test/mlrn-mock';
import {
  FLEET_SOURCE_ID,
  ROUTE_ALT_SOURCE_ID,
  ROUTE_LAYER_IDS,
  ROUTE_SOURCE_ID,
  RouteLayers,
} from './route-layers';
import { createRoutesStore } from './routes-store';

vi.mock('react-native', () => import('../test/react-native-mock'));
vi.mock('@maplibre/maplibre-react-native', () => import('../test/mlrn-mock'));

const response = fixture as unknown as DirectionsResponse;
const withAlt: DirectionsResponse = {
  ...response,
  routes: [
    response.routes[0],
    { ...response.routes[0], distance_m: 1 },
  ] as DirectionsResponse['routes'],
};
// Marker của SDK đọc MapContext → cần một MapHandle giả trong context.
const handle = { places: {} as MapsLibVNClient } as unknown as MapHandle;
const layer = (id: string) =>
  JSON.parse(screen.getByTestId(`mlrn-layer-${id}`).dataset.layer ?? '{}') as Record<
    string,
    unknown
  >;
const geojson = () =>
  JSON.parse(screen.getByTestId(`mlrn-source-${ROUTE_SOURCE_ID}`).dataset.geojson ?? '{}') as {
    features: { properties: { kind: string } }[];
  };

afterEach(() => {
  cleanup();
  resetMocks();
});

describe('RouteLayers', () => {
  it('không có tuyến → không render; show → source + 4 layer line trước beforeId, ảnh puck đăng ký, marker đích', () => {
    const store = createRoutesStore();
    const { rerender } = render(
      <MapContext.Provider value={handle}>
        <RouteLayers store={store} beforeId="road_one_way_arrow" />
      </MapContext.Provider>,
    );
    expect(screen.queryByTestId(`mlrn-source-${ROUTE_SOURCE_ID}`)).toBeNull();
    act(() => store.show(response));
    rerender(
      <MapContext.Provider value={handle}>
        <RouteLayers store={store} beforeId="road_one_way_arrow" />
      </MapContext.Provider>,
    );
    expect(geojson().features.map((f) => f.properties.kind)).toEqual(['active']);
    for (const id of [
      ROUTE_LAYER_IDS.alt,
      ROUTE_LAYER_IDS.casing,
      ROUTE_LAYER_IDS.line,
      ROUTE_LAYER_IDS.traveled,
    ]) {
      expect(layer(id).beforeId).toBe('road_one_way_arrow');
      expect(layer(id).type).toBe('line');
    }
    expect(layer(ROUTE_LAYER_IDS.line).paint).toEqual({ 'line-color': '#2458a6', 'line-width': 6 });
    expect(screen.getByTestId('mlrn-images').dataset.keys).toBe('mapslibvn-puck');
    // Layer puck luôn có khi puck bật; chưa có progress thì source không có feature puck (kinds ở trên).
    expect(screen.getByTestId(`mlrn-layer-${ROUTE_LAYER_IDS.puck}`)).toBeTruthy();
    const markers = screen.getAllByTestId('mapslibvn-route-marker');
    expect(markers).toHaveLength(1);
    expect(markers[0]?.dataset.lnglat).toBe(response.waypoints[1]?.snapped.join(','));
  });

  it('progress → traveled/active/puck; layer puck xoay theo bearing, không beforeId; routeStyle đổi màu', () => {
    const store = createRoutesStore();
    store.show(response);
    store.setProgress({ shapeIndex: 5, snapped: [106.6985, 10.7791], bearing: 77 });
    render(
      <MapContext.Provider value={handle}>
        <RouteLayers
          store={store}
          beforeId={null}
          routeStyle={{ color: '#ff0000', traveledOpacity: 0.5 }}
        />
      </MapContext.Provider>,
    );
    expect(geojson().features.map((f) => f.properties.kind)).toEqual([
      'traveled',
      'active',
      'puck',
    ]);
    const puck = layer(ROUTE_LAYER_IDS.puck);
    expect(puck.type).toBe('symbol');
    expect(puck.beforeId).toBeUndefined();
    expect(puck.layout).toMatchObject({
      'icon-image': 'mapslibvn-puck',
      'icon-rotate': ['get', 'bearing'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
    });
    expect(layer(ROUTE_LAYER_IDS.line).beforeId).toBeUndefined();
    expect(layer(ROUTE_LAYER_IDS.line).paint).toMatchObject({ 'line-color': '#ff0000' });
    expect(layer(ROUTE_LAYER_IDS.traveled).paint).toMatchObject({ 'line-opacity': 0.5 });
  });

  it('bấm tuyến thay thế → onRouteClick(index); puck tắt → không layer puck', () => {
    const store = createRoutesStore();
    store.show(withAlt, { active: 0 });
    store.setProgress({ shapeIndex: 5, snapped: [106.6985, 10.7791], bearing: 0 });
    store.setPuck(false);
    const onRouteClick = vi.fn();
    render(
      <MapContext.Provider value={handle}>
        <RouteLayers store={store} beforeId={null} onRouteClick={onRouteClick} />
      </MapContext.Provider>,
    );
    expect(screen.queryByTestId(`mlrn-layer-${ROUTE_LAYER_IDS.puck}`)).toBeNull();
    getSourceProps(ROUTE_ALT_SOURCE_ID)?.onPress?.({
      nativeEvent: { features: [{ properties: { kind: 'alt', index: 1 } }] },
    });
    expect(onRouteClick).toHaveBeenCalledWith(1);
    getSourceProps(ROUTE_ALT_SOURCE_ID)?.onPress?.({
      nativeEvent: { features: [{ properties: { kind: 'active', index: 0 } }] },
    });
    expect(onRouteClick).toHaveBeenCalledTimes(1);
  });

  it('tuyến thay thế nằm ở source riêng; định vị mới không đẩy lại dữ liệu của nó (B1)', () => {
    const store = createRoutesStore();
    store.show(withAlt, { active: 0 });
    const el = (
      <MapContext.Provider value={handle}>
        <RouteLayers store={store} beforeId={null} />
      </MapContext.Provider>
    );
    const { rerender } = render(el);
    expect(layer(ROUTE_LAYER_IDS.alt).source).toBe(ROUTE_ALT_SOURCE_ID);
    const altData = getSourceProps(ROUTE_ALT_SOURCE_ID)?.data;
    const liveData = getSourceProps(ROUTE_SOURCE_ID)?.data;
    act(() => store.setProgress({ shapeIndex: 5, snapped: [106.6985, 10.7791], bearing: 0 }));
    rerender(el);
    // Cùng tham chiếu → MLRN không gửi lại GeoJSON tuyến thay thế qua cầu native mỗi giây.
    expect(getSourceProps(ROUTE_ALT_SOURCE_ID)?.data).toBe(altData);
    expect(getSourceProps(ROUTE_SOURCE_ID)?.data).not.toBe(liveData);
  });
});

const plan = fleetFixture as unknown as FleetPlanResponse;

describe('RouteLayers — đội xe', () => {
  it('showFleet → source đội xe với 2 layer line data-driven, marker màu xe tại từng đơn, bấm tuyến → onRouteClick(index)', () => {
    const store = createRoutesStore();
    store.showFleet(plan);
    const onRouteClick = vi.fn();
    render(
      <MapContext.Provider value={handle}>
        <RouteLayers store={store} beforeId="road_one_way_arrow" onRouteClick={onRouteClick} />
      </MapContext.Provider>,
    );
    expect(screen.queryByTestId(`mlrn-source-${ROUTE_SOURCE_ID}`)).toBeNull();
    const geo = JSON.parse(
      screen.getByTestId(`mlrn-source-${FLEET_SOURCE_ID}`).dataset.geojson ?? '{}',
    ) as { features: { properties: { kind: string; index: number; color: string } }[] };
    expect(geo.features.map((f) => f.properties.kind)).toEqual(['fleet', 'fleet']);
    expect(geo.features.map((f) => f.properties.color)).toEqual(['#0072b2', '#d55e00']);
    expect(layer(ROUTE_LAYER_IDS.fleetLine).paint).toEqual({
      'line-color': ['get', 'color'],
      'line-width': 6,
      'line-opacity': ['get', 'opacity'],
    });
    expect(layer(ROUTE_LAYER_IDS.fleetCasing).beforeId).toBe('road_one_way_arrow');
    const soDon = plan.vehicles.reduce((sum, v) => sum + v.jobs.length, 0);
    const markers = screen.getAllByTestId('mapslibvn-fleet-marker');
    expect(markers).toHaveLength(soDon);
    expect(markers[0]?.dataset.lnglat).toBe(plan.vehicles[0]?.waypoints[1]?.snapped.join(','));
    getSourceProps(FLEET_SOURCE_ID)?.onPress?.({
      nativeEvent: { features: [{ properties: { kind: 'fleet', index: 1 } }] },
    });
    expect(onRouteClick).toHaveBeenCalledWith(1);
  });

  it('markers:false → không marker; clear → không render gì', () => {
    const store = createRoutesStore();
    store.showFleet(plan, { markers: false });
    const { rerender } = render(
      <MapContext.Provider value={handle}>
        <RouteLayers store={store} beforeId={null} />
      </MapContext.Provider>,
    );
    expect(screen.queryAllByTestId('mapslibvn-fleet-marker')).toHaveLength(0);
    act(() => store.clear());
    rerender(
      <MapContext.Provider value={handle}>
        <RouteLayers store={store} beforeId={null} />
      </MapContext.Provider>,
    );
    expect(screen.queryByTestId(`mlrn-source-${FLEET_SOURCE_ID}`)).toBeNull();
  });
});
