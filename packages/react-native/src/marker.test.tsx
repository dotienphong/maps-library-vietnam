// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapsLibVNMap } from './map';
import { DEFAULT_MARKER_COLOR, Marker } from './marker';

vi.mock('react-native', () => import('./test/react-native-mock'));
vi.mock('@maplibre/maplibre-react-native', () => import('./test/mlrn-mock'));

const base = { apiKey: 'mlv_live_k', apiBase: 'https://api.test' };

afterEach(cleanup);

describe('Marker', () => {
  it('không children → ghim mặc định, anchor center, lngLat đúng', () => {
    render(
      <MapsLibVNMap {...base}>
        <Marker lng={106.7} lat={10.776} testID="m1" />
      </MapsLibVNMap>,
    );
    const m = screen.getByTestId('m1');
    expect(m.dataset.lnglat).toBe('106.7,10.776');
    expect(m.dataset.anchor).toBe('center');
    expect(screen.getByTestId('mapslibvn-marker-pin')).toBeTruthy();
    expect(DEFAULT_MARKER_COLOR).toBe('#3FB1CE');
  });

  it('children tuỳ ý + anchor bottom + onPress', () => {
    const onPress = vi.fn();
    render(
      <MapsLibVNMap {...base}>
        <Marker lng={1} lat={2} anchor="bottom" onPress={onPress} testID="m2">
          <span data-testid="custom">★</span>
        </Marker>
      </MapsLibVNMap>,
    );
    expect(screen.getByTestId('custom')).toBeTruthy();
    expect(screen.queryByTestId('mapslibvn-marker-pin')).toBeNull();
    expect(screen.getByTestId('m2').dataset.anchor).toBe('bottom');
    fireEvent.click(screen.getByTestId('m2'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('ngoài <MapsLibVNMap> ném lỗi', () => {
    expect(() => render(<Marker lng={1} lat={2} />)).toThrow(/bên trong <MapsLibVNMap>/);
  });
});
