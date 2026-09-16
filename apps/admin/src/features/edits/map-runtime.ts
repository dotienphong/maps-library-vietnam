import { Protocol } from 'pmtiles';
import type { MapPlan } from './edit-map';

/**
 * Phần mặt của `maplibre-gl` mà màn chi tiết dùng tới. Khai hẹp để test tiêm được bản giả:
 * `maplibre-gl` thật cần WebGL nên không dựng được trong jsdom, và chính vì trước đây không có
 * cách tiêm mà cả khối dựng bản đồ chưa từng được test lần nào.
 */
export interface MaplibreLike {
  addProtocol(name: string, loadFn: Protocol['tile']): void;
  Map: new (options: {
    container: HTMLElement;
    style: string;
    center: [number, number];
    zoom: number;
    attributionControl: { compact: boolean };
  }) => MapLike;
  Marker: new (options: { color: string; scale?: number }) => MarkerLike;
  Popup: new () => PopupLike;
}

interface MapLike {
  on(event: 'load', handler: () => void): void;
  addSource(id: string, source: unknown): void;
  addLayer(layer: unknown): void;
  fitBounds(bounds: [[number, number], [number, number]], options: unknown): void;
}

interface MarkerLike {
  setLngLat(position: [number, number]): MarkerLike;
  setPopup(popup: PopupLike): MarkerLike;
  addTo(map: MapLike): MarkerLike;
}

interface PopupLike {
  setText(text: string): PopupLike;
}

const COLOR_CU = '#98a2b3';
const COLOR_MOI = '#1b3a6b';

let protocolRegistered = false;

/**
 * Style do `/v1/styles/*.json` trả về trỏ nguồn dữ liệu bằng `pmtiles://`, một giao thức
 * maplibre KHÔNG hiểu sẵn. Thiếu bước đăng ký này thì bản đồ dựng lên nhưng trống trơn — không
 * báo lỗi gì, vì với maplibre đó chỉ là một nguồn không tải được.
 */
export function ensurePmtilesProtocol(host: MaplibreLike): void {
  if (protocolRegistered) return;
  host.addProtocol('pmtiles', new Protocol().tile);
  protocolRegistered = true;
}

export function resetProtocolForTests(): void {
  protocolRegistered = false;
}

/** Dựng bản đồ theo kế hoạch đã quyết ở `mapPlan`. Không tự import maplibre để test tiêm được. */
export function createMapOnto(
  maplibre: MaplibreLike,
  container: HTMLElement,
  plan: MapPlan,
): MapLike | null {
  if (plan.mode === 'khong-ve') return null;

  ensurePmtilesProtocol(maplibre);

  const dark = document.documentElement.classList.contains('dark');
  const center: [number, number] =
    plan.mode === 'so-sanh' ? [plan.after.lng, plan.after.lat] : [plan.point.lng, plan.point.lat];

  // Đường dẫn tương đối: trang admin cùng origin với Worker, và /v1/styles/* không đòi khoá API.
  const map = new maplibre.Map({
    container,
    style: dark ? '/v1/styles/dark.json' : '/v1/styles/light.json',
    attributionControl: { compact: true },
    center,
    zoom: 15,
  });

  map.on('load', () => {
    if (plan.mode === 'mot-chot') {
      for (const poi of plan.nearby) {
        new maplibre.Marker({ color: COLOR_CU, scale: 0.7 })
          .setLngLat([poi.lng, poi.lat])
          .setPopup(new maplibre.Popup().setText(`${poi.name ?? poi.id} · ${poi.distance_m} m`))
          .addTo(map);
      }
      new maplibre.Marker({ color: COLOR_MOI })
        .setLngLat([plan.point.lng, plan.point.lat])
        .addTo(map);
      return;
    }

    new maplibre.Marker({ color: COLOR_CU })
      .setLngLat([plan.before.lng, plan.before.lat])
      .addTo(map);
    new maplibre.Marker({ color: COLOR_MOI })
      .setLngLat([plan.after.lng, plan.after.lat])
      .addTo(map);

    map.addSource('duong-noi', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [plan.before.lng, plan.before.lat],
            [plan.after.lng, plan.after.lat],
          ],
        },
      },
    });
    map.addLayer({
      id: 'duong-noi',
      type: 'line',
      source: 'duong-noi',
      paint: { 'line-color': COLOR_CU, 'line-width': 2, 'line-dasharray': [2, 2] },
    });
    map.fitBounds(
      [
        [Math.min(plan.before.lng, plan.after.lng), Math.min(plan.before.lat, plan.after.lat)],
        [Math.max(plan.before.lng, plan.after.lng), Math.max(plan.before.lat, plan.after.lat)],
      ],
      { padding: 56, maxZoom: 17 },
    );
  });

  return map;
}
