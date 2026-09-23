// @vitest-environment jsdom
import { nameExpression } from '@mapslibvn/core';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapsLibVNMap, POI_TOUCH_RADIUS_PX, prefetchBounds, useMap } from './map';
import {
  cameraRefMock,
  getLastMapProps,
  mapRefMock,
  OfflineManager,
  offlinePacks,
  resetMocks,
} from './test/mlrn-mock';

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
  it('mặc định: mapStyle là URL light, camera khởi tạo HCM zoom 12, không logo, ghi nguồn do SDK vẽ', () => {
    render(<MapsLibVNMap {...base} />);
    expect(screen.getByTestId('mlrn-map').dataset.style).toBe(
      'https://api.test/v1/styles/light.json?key=mlv_live_k&sources=osm%2Cfsq',
    );
    expect(screen.getByTestId('mlrn-camera').dataset.view).toBe(
      JSON.stringify({ center: [106.7, 10.776], zoom: 12 }),
    );
    const props = getLastMapProps();
    expect(props?.logo).toBe(false);
    // Nút "i" native tắt: hộp thoại của nó đọc metadata PMTiles nên thiếu © MapsLibVN và Foursquare.
    expect(props?.attribution).toBe(false);
    expect(screen.getByTestId('mapslibvn-attribution')).toBeTruthy();
  });

  it('poiSources đi vào style URL và client; đổi prop tạo lại map', () => {
    const { rerender } = render(<MapsLibVNMap {...base} poiSources={['fsq']} />);
    expect(screen.getByTestId('mlrn-map').dataset.style).toMatch(/sources=fsq$/);
    rerender(<MapsLibVNMap {...base} poiSources={['osm', 'fsq']} />);
    expect(screen.getByTestId('mlrn-map').dataset.style).toContain('sources=osm%2Cfsq');
    const onLoad = vi.fn();
    rerender(<MapsLibVNMap {...base} poiSources={['osm']} onLoad={onLoad} />);
    expect(screen.getByTestId('mlrn-map').dataset.style).toMatch(/sources=osm$/);
    const props = getLastMapProps() as unknown as { onDidFinishLoadingStyle: () => void };
    act(() => props.onDidFinishLoadingStyle());
    expect(onLoad.mock.calls[0]?.[0].places.styleUrl('light')).toMatch(/sources=osm$/);
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

  it('onPress → queryRenderedFeatures ô vuông quanh điểm chạm, lớp poi → onPoiClick', async () => {
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
    // Điểm chạm (10, 20) nở ra ±POI_TOUCH_RADIUS_PX: chạm lệch vài pixel vẫn trúng POI (B2).
    expect(mapRefMock.queryRenderedFeatures).toHaveBeenCalledWith(
      [
        [10 - POI_TOUCH_RADIUS_PX, 20 - POI_TOUCH_RADIUS_PX],
        [10 + POI_TOUCH_RADIUS_PX, 20 + POI_TOUCH_RADIUS_PX],
      ],
      { layers: ['poi'] },
    );
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

  it('bấm attribution → danh sách nguồn của SDK, không gọi hộp thoại native; onError khi map lỗi', () => {
    const onError = vi.fn();
    render(<MapsLibVNMap {...base} onError={onError} />);
    fireEvent.click(screen.getByTestId('mapslibvn-attribution'));
    expect(screen.getAllByTestId('mapslibvn-attribution-link')).toHaveLength(4);
    expect(mapRefMock.showAttribution).not.toHaveBeenCalled();
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

describe('MapsLibVNMap — style đóng gói sẵn (A2)', () => {
  it('styleJson: vẽ ngay bằng chính JSON đó, không gọi mạng', () => {
    const json = { version: 8, sources: {}, layers: [] } as never;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<MapsLibVNMap {...base} styleJson={json} />);
    // Không qua nhịp "đang tải" nào: map có mặt ngay ở lần render đầu.
    expect(screen.getByTestId('mlrn-map').dataset.style).toBe(JSON.stringify(json));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('styleJson + lang=en: vẫn áp ngôn ngữ, vẫn không gọi mạng', () => {
    const json = {
      version: 8,
      sources: {},
      layers: [
        { id: 'city', type: 'symbol', source: 's', layout: { 'text-field': ['get', 'name'] } },
      ],
    } as never;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<MapsLibVNMap {...base} styleJson={json} lang="en" />);
    const style = JSON.parse(screen.getByTestId('mlrn-map').dataset.style ?? 'null');
    expect(style.layers[0].layout['text-field']).toEqual(nameExpression('en'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('MapsLibVNMap — đổi theme không dựng lại map (A3)', () => {
  it('đổi style/lang/poiLayer: giữ nguyên map native, chỉ đổi mapStyle', () => {
    const { rerender } = render(<MapsLibVNMap {...base} />);
    const before = screen.getByTestId('mlrn-map');
    rerender(<MapsLibVNMap {...base} style="dark" />);
    const after = screen.getByTestId('mlrn-map');
    // Cùng một node DOM = React không unmount/mount lại <Map> → không trắng màn, không tải lại tile.
    expect(after).toBe(before);
    expect(after.dataset.style).toContain('/v1/styles/dark.json');
  });

  it('đổi apiKey/poiSources thì vẫn dựng lại map (client đổi theo)', () => {
    const { rerender } = render(<MapsLibVNMap {...base} />);
    const before = screen.getByTestId('mlrn-map');
    rerender(<MapsLibVNMap {...base} poiSources={['osm']} />);
    expect(screen.getByTestId('mlrn-map')).not.toBe(before);
  });
});

describe('MapsLibVNMap — tải trước tile (A4)', () => {
  it('mặc định không tải trước gì', async () => {
    render(<MapsLibVNMap {...base} />);
    await waitFor(() => expect(screen.getByTestId('mlrn-map')).toBeTruthy());
    expect(OfflineManager.createPack).not.toHaveBeenCalled();
  });

  it('prefetch: tạo đúng một pack, đúng hộp bao và zoom mặc định', async () => {
    render(<MapsLibVNMap {...base} prefetch center={[106.7, 10.776]} />);
    await waitFor(() => expect(offlinePacks).toHaveLength(1));
    const pack = offlinePacks[0];
    expect(pack?.bounds).toEqual(prefetchBounds([106.7, 10.776], 2));
    expect(pack?.minZoom).toBe(12);
    expect(pack?.maxZoom).toBe(15);
    expect(pack?.mapStyle).toBe(
      'https://api.test/v1/styles/light.json?key=mlv_live_k&sources=osm%2Cfsq',
    );
  });

  it('prefetch nhận tuỳ chọn riêng và không tạo pack trùng ở lần mount sau', async () => {
    render(<MapsLibVNMap {...base} prefetch={{ radiusKm: 5, maxZoom: 14 }} />);
    await waitFor(() => expect(offlinePacks).toHaveLength(1));
    expect(offlinePacks[0]?.bounds).toEqual(prefetchBounds([106.7, 10.776], 5));
    expect(offlinePacks[0]?.maxZoom).toBe(14);

    cleanup();
    render(<MapsLibVNMap {...base} prefetch={{ radiusKm: 5, maxZoom: 14 }} />);
    await waitFor(() => expect(OfflineManager.getPacks).toHaveBeenCalledTimes(2));
    expect(offlinePacks).toHaveLength(1);
  });

  it('getPacks lỗi → onError, bản đồ vẫn hiện', async () => {
    OfflineManager.getPacks.mockRejectedValueOnce(new Error('hết dung lượng'));
    const onError = vi.fn();
    render(<MapsLibVNMap {...base} prefetch onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]?.[0].message).toBe('hết dung lượng');
    expect(screen.getByTestId('mlrn-map')).toBeTruthy();
  });
});
