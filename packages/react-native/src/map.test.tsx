// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapsLibVNMap, useMap } from './map';
import { cameraRefMock, getLastMapProps, mapRefMock, resetMocks } from './test/mlrn-mock';

vi.mock('react-native', () => import('./test/react-native-mock'));
vi.mock('@maplibre/maplibre-react-native', () => import('./test/mlrn-mock'));

const base = { apiKey: 'mlv_live_k', apiBase: 'https://api.test' };
type PressEvent = { nativeEvent: { point: [number, number]; lngLat: [number, number] } };
const press = (): PressEvent => ({ nativeEvent: { point: [10, 20], lngLat: [106.7, 10.77] } });

afterEach(() => {
  cleanup();
  resetMocks();
  vi.restoreAllMocks();
});

describe('MapsLibVNMap', () => {
  it('mặc định: mapStyle là URL light, camera khởi tạo HCM zoom 12, không logo, có attribution', () => {
    render(<MapsLibVNMap {...base} />);
    expect(screen.getByTestId('mlrn-map').dataset.style).toBe(
      'https://api.test/v1/styles/light.json?key=mlv_live_k&sources=osm%2Coverture%2Cfsq',
    );
    expect(screen.getByTestId('mlrn-camera').dataset.view).toBe(
      JSON.stringify({ center: [106.7, 10.776], zoom: 12 }),
    );
    const props = getLastMapProps();
    expect(props?.logo).toBe(false);
    expect(props?.attribution).toBe(true);
    expect(screen.getByTestId('mapslibvn-attribution')).toBeTruthy();
  });

  it('poiSources đi vào style URL và client; đổi prop tạo lại map', () => {
    const { rerender } = render(<MapsLibVNMap {...base} poiSources={['fsq']} />);
    expect(screen.getByTestId('mlrn-map').dataset.style).toContain('sources=fsq');
    expect(screen.getByTestId('mlrn-map').dataset.style).not.toContain('overture');
    const onLoad = vi.fn();
    rerender(<MapsLibVNMap {...base} poiSources={['overture', 'fsq']} onLoad={onLoad} />);
    expect(screen.getByTestId('mlrn-map').dataset.style).toContain('sources=overture%2Cfsq');
    const props = getLastMapProps() as unknown as { onDidFinishLoadingStyle: () => void };
    act(() => props.onDidFinishLoadingStyle());
    expect(onLoad.mock.calls[0]?.[0].places.styleUrl('light')).toContain('sources=overture%2Cfsq');
  });

  it('style dark + center/zoom truyền vào', () => {
    render(<MapsLibVNMap {...base} style="dark" center={[105.85, 21.03]} zoom={10} />);
    expect(screen.getByTestId('mlrn-map').dataset.style).toContain('/v1/styles/dark.json');
    expect(screen.getByTestId('mlrn-camera').dataset.view).toBe(
      JSON.stringify({ center: [105.85, 21.03], zoom: 10 }),
    );
  });

  it('lang=en: fetch style rồi truyền object', async () => {
    const json = { version: 8, sources: {}, layers: [] };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(json)));
    render(<MapsLibVNMap {...base} lang="en" />);
    expect(screen.queryByTestId('mlrn-map')).toBeNull(); // đang tải
    await waitFor(() => expect(screen.getByTestId('mlrn-map')).toBeTruthy());
    expect(screen.getByTestId('mlrn-map').dataset.style).toBe(JSON.stringify(json));
  });

  it('onLoad gọi đúng một lần với MapHandle khi style tải xong', () => {
    const onLoad = vi.fn();
    render(<MapsLibVNMap {...base} onLoad={onLoad} />);
    const props = getLastMapProps() as unknown as { onDidFinishLoadingStyle: () => void };
    act(() => props.onDidFinishLoadingStyle());
    act(() => props.onDidFinishLoadingStyle());
    expect(onLoad).toHaveBeenCalledTimes(1);
    const handle = onLoad.mock.calls[0]?.[0];
    expect(handle.places.baseUrl).toBe('https://api.test');
    handle.flyTo([106.7, 10.77], 15);
    expect(cameraRefMock.flyTo).toHaveBeenCalledWith({ center: [106.7, 10.77], zoom: 15 });
    handle.fitBounds([106.6, 10.7, 106.8, 10.9]);
    expect(cameraRefMock.fitBounds).toHaveBeenCalledWith([106.6, 10.7, 106.8, 10.9], {
      padding: { top: 40, right: 40, bottom: 40, left: 40 },
    });
  });

  it('onPress → queryRenderedFeatures lớp poi → onPoiClick', async () => {
    mapRefMock.queryRenderedFeatures.mockResolvedValueOnce([
      {
        type: 'Feature',
        properties: { id: 'p1', name: 'Cafe', cat: 'cafe', grp: 'food_drink' },
        geometry: { type: 'Point', coordinates: [106.66, 10.76] },
      },
    ]);
    const onPoiClick = vi.fn();
    render(<MapsLibVNMap {...base} onPoiClick={onPoiClick} />);
    const props = getLastMapProps() as unknown as { onPress: (e: PressEvent) => Promise<void> };
    await act(() => props.onPress(press()));
    expect(mapRefMock.queryRenderedFeatures).toHaveBeenCalledWith([10, 20], { layers: ['poi'] });
    expect(onPoiClick).toHaveBeenCalledWith({
      id: 'p1',
      name: 'Cafe',
      category: 'cafe',
      group: 'food_drink',
      lngLat: [106.66, 10.76],
    });
  });

  it('không query khi poiLayer=false hoặc không có onPoiClick', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ version: 8, sources: {}, layers: [] })),
    );
    const onPoiClick = vi.fn();
    render(<MapsLibVNMap {...base} poiLayer={false} onPoiClick={onPoiClick} />);
    await waitFor(() => expect(screen.getByTestId('mlrn-map')).toBeTruthy());
    let props = getLastMapProps() as unknown as { onPress: (e: PressEvent) => Promise<void> };
    await act(() => props.onPress(press()));
    expect(mapRefMock.queryRenderedFeatures).not.toHaveBeenCalled();

    cleanup();
    resetMocks();
    render(<MapsLibVNMap {...base} />);
    props = getLastMapProps() as unknown as { onPress: (e: PressEvent) => Promise<void> };
    await act(() => props.onPress(press()));
    expect(mapRefMock.queryRenderedFeatures).not.toHaveBeenCalled();
  });

  it('bấm attribution → showAttribution native; onError khi map lỗi', () => {
    const onError = vi.fn();
    render(<MapsLibVNMap {...base} onError={onError} />);
    fireEvent.click(screen.getByTestId('mapslibvn-attribution'));
    expect(mapRefMock.showAttribution).toHaveBeenCalledTimes(1);
    const props = getLastMapProps() as unknown as { onDidFailLoadingMap: () => void };
    act(() => props.onDidFailLoadingMap());
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Không tải được bản đồ' }),
    );
  });

  it('bundleId → client gửi X-Bundle-Id', async () => {
    const onLoad = vi.fn();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ items: [] })));
    render(<MapsLibVNMap {...base} bundleId="vn.mapslibvn.demo" onLoad={onLoad} />);
    act(() =>
      (
        getLastMapProps() as unknown as { onDidFinishLoadingStyle: () => void }
      ).onDidFinishLoadingStyle(),
    );
    await onLoad.mock.calls[0]?.[0].places.autocomplete('cafe');
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-Bundle-Id']).toBe('vn.mapslibvn.demo');
  });

  it('useMap ngoài <MapsLibVNMap> ném lỗi tiếng Việt; bên trong trả handle', () => {
    function Probe() {
      const map = useMap();
      return <span data-testid="probe">{map.places.baseUrl}</span>;
    }
    expect(() => render(<Probe />)).toThrow(/bên trong <MapsLibVNMap>/);
    render(
      <MapsLibVNMap {...base}>
        <Probe />
      </MapsLibVNMap>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('https://api.test');
  });
});
