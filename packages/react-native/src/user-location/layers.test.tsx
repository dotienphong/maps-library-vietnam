// @vitest-environment jsdom
import type { DirectionsResponse, GeoFix, HeadingFix } from '@mapslibvn/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../core/tests/fixtures/directions-q1.json';
import { HEADING_CONE_IMAGE_KEY } from '../navigation/puck-image';
import { createRoutesStore } from '../navigation/routes-store';
import { USER_LOCATION_LAYER_IDS, USER_LOCATION_SOURCE_ID, UserLocationLayers } from './layers';
import { createUserLocationStore } from './store';

vi.mock('react-native', () => import('../test/react-native-mock'));
vi.mock('@maplibre/maplibre-react-native', () => import('../test/mlrn-mock'));

const response = fixture as unknown as DirectionsResponse;
const fix: GeoFix = { lng: 106.7, lat: 10.78, accuracy_m: 25, timestamp: 1 };
const heading: HeadingFix = { heading: 90, accuracy: 'high', timestamp: 1, source: 'fused' };
const layer = (id: string) =>
  JSON.parse(screen.getByTestId(`mlrn-layer-${id}`).dataset.layer ?? '{}') as Record<string, unknown>;

afterEach(cleanup);

describe('<UserLocationLayers>', () => {
  it('không fix → null; có fix → Images nón + source + 3 lớp theo thứ tự accuracy, cone, dot', () => {
    const store = createUserLocationStore();
    const routes = createRoutesStore();
    const { container, rerender } = render(
      <UserLocationLayers store={store} routesStore={routes} accuracyCircle beforeId="poi" />,
    );
    expect(container.innerHTML).toBe('');
    store.setFix(fix);
    store.setHeading(heading);
    rerender(<UserLocationLayers store={store} routesStore={routes} accuracyCircle beforeId="poi" />);
    expect(screen.getByTestId('mlrn-images').dataset.keys).toBe(HEADING_CONE_IMAGE_KEY);
    const geo = JSON.parse(
      screen.getByTestId(`mlrn-source-${USER_LOCATION_SOURCE_ID}`).dataset.geojson ?? '{}',
    ) as { features: { properties: { bearing: number } }[] };
    expect(geo.features[0]?.properties.bearing).toBe(90);
    const ids = [...container.querySelectorAll('[data-testid^="mlrn-layer-"]')].map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(ids).toEqual([
      `mlrn-layer-${USER_LOCATION_LAYER_IDS.accuracy}`,
      `mlrn-layer-${USER_LOCATION_LAYER_IDS.cone}`,
      `mlrn-layer-${USER_LOCATION_LAYER_IDS.dot}`,
    ]);
    expect(layer(USER_LOCATION_LAYER_IDS.dot).beforeId).toBe('poi');
    const cone = layer(USER_LOCATION_LAYER_IDS.cone) as { layout: Record<string, unknown>; paint: Record<string, unknown>; filter: unknown };
    expect(cone.layout['icon-image']).toBe(HEADING_CONE_IMAGE_KEY);
    expect(cone.layout['icon-rotate']).toEqual(['get', 'bearing']);
    expect(cone.paint['icon-opacity']).toEqual(['case', ['get', 'hasReliableHeading'], 1, 0.45]);
    expect(cone.filter).toEqual(['==', ['get', 'hasHeading'], true]);
    const acc = layer(USER_LOCATION_LAYER_IDS.accuracy) as { paint: { 'circle-radius': unknown[] } };
    expect(acc.paint['circle-radius'].slice(0, 3)).toEqual(['interpolate', ['exponential', 2], ['zoom']]);
  });

  it('accuracyCircle=false bỏ vòng; dẫn đường có tiến độ → null', () => {
    const store = createUserLocationStore();
    const routes = createRoutesStore();
    store.setFix(fix);
    const { container, rerender } = render(
      <UserLocationLayers store={store} routesStore={routes} accuracyCircle={false} beforeId={null} />,
    );
    expect(screen.queryByTestId(`mlrn-layer-${USER_LOCATION_LAYER_IDS.accuracy}`)).toBeNull();
    expect(screen.getByTestId(`mlrn-layer-${USER_LOCATION_LAYER_IDS.dot}`)).toBeTruthy();
    routes.show(response);
    routes.setProgress({ shapeIndex: 2, snapped: [106.69, 10.77], bearing: 0 });
    rerender(
      <UserLocationLayers store={store} routesStore={routes} accuracyCircle={false} beforeId={null} />,
    );
    expect(container.innerHTML).toBe('');
  });
});
