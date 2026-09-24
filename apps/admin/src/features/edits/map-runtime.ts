import type { createMap as createMapFn, MapsLibVNMap } from '@mapslibvn/web';
import type * as maplibregl from 'maplibre-gl';
import type { MapPlan } from './edit-map';

/**
 * Dùng chính SDK web của MapsLibVN thay vì tự dựng maplibre. Lý do không chỉ là tiết kiệm mã:
 * bản tự dựng ngày 16/09 vẽ được chốt vị trí nhưng nền luôn trắng, trong khi cùng lúc đó SDK
 * dựng bản đồ đầy đủ — đo bằng ảnh cùng một phép: 927 KB so với 12 KB. SDK lo giao thức pmtiles,
 * hợp đồng style và attribution bắt buộc; trang admin không có lý do gì làm lại những việc đó.
 *
 * Kèm một lợi ích: trang quản trị dùng đúng thứ khách hàng dùng, nên lỗi SDK sẽ lộ ra ở đây
 * trước khi khách gặp.
 */
export interface MapDeps {
  createMap: typeof createMapFn;
  maplibre: typeof maplibregl;
}

const COLOR_CU = '#98a2b3';
/** Chấm vị trí mới trên bản đồ SÁNG: #a3e635 chỉ đạt 1,4:1 trên nền sáng nên dùng ô liu đậm. */
const COLOR_MOI = '#4d7c0f';

/**
 * Bộ tiles dừng ở mức phóng 14 (đo trên archive production 16/09: z14 có ô, z15 trở lên không).
 * Khoảng cách chính xác vẫn đọc được ở nhãn "Lệch X m" nên không mất thông tin.
 */
const MAX_ZOOM = 14;

/**
 * Route `/v1/styles/*` không kiểm khoá, nên trang admin KHÔNG nhúng khoá thật vào bundle tĩnh.
 * Chuỗi này chỉ để SDK dựng được URL; nếu sau này styles bắt buộc khoá thì phải lấy khoá động
 * qua một endpoint nằm sau Access, đừng nhúng cứng.
 */
const API_KEY_PLACEHOLDER = 'admin-noi-bo';

export function createMapOnto(
  deps: MapDeps,
  container: HTMLElement,
  plan: MapPlan,
  onError?: (message: string) => void,
): MapsLibVNMap | null {
  if (plan.mode === 'khong-ve') return null;

  const dark = document.documentElement.classList.contains('dark');
  const center: [number, number] =
    plan.mode === 'so-sanh' ? [plan.after.lng, plan.after.lat] : [plan.point.lng, plan.point.lat];

  const map = deps.createMap(
    {
      container,
      apiKey: API_KEY_PLACEHOLDER,
      apiBase: location.origin,
      style: dark ? 'dark' : 'light',
      center,
      zoom: MAX_ZOOM,
      compactAttribution: true,
    },
    { maplibre: deps.maplibre },
  );

  /**
   * Bản đồ được dựng bên trong hộp thoại chi tiết, nên lúc khởi tạo container có thể chưa có
   * kích thước thật. maplibre đọc kích thước đúng một lần khi tạo; nếu lúc đó khung còn rỗng thì
   * nó không yêu cầu ô nào và nền trắng trơn — dù style tải xong và chốt vị trí vẫn hiện, vì chốt
   * là phần tử DOM. Báo lại mỗi lần container đổi kích thước là cách chắc chắn, không phụ thuộc
   * thời điểm hộp thoại chạy xong hiệu ứng mở.
   */
  if (typeof ResizeObserver === 'function') {
    const theoDoi = new ResizeObserver(() => map.gl.resize());
    theoDoi.observe(container);
  }

  // Bản đồ hỏng phải nói ra. Trước đây nó im lặng, nên một nguồn dữ liệu 404 trông y hệt một
  // tính năng chưa làm — người dùng không có cách nào phân biệt.
  map.gl.on('error', (payload: { error?: { message?: string } }) => {
    const message = payload?.error?.message?.trim();
    onError?.(message && message.length > 0 ? message : 'Không rõ nguyên nhân');
  });

  // Chốt vị trí vẽ NGAY, không chờ sự kiện nào: marker là phần tử DOM chồng lên bản đồ. Buộc nó
  // chờ nghĩa là nền chậm hay thiếu ô thì người duyệt mất luôn thông tin quan trọng nhất.
  if (plan.mode === 'mot-chot') {
    for (const poi of plan.nearby) {
      map.addMarker({
        lng: poi.lng,
        lat: poi.lat,
        color: COLOR_CU,
        // Văn bản thuần, KHÔNG phải HTML: tên POI đến nguyên văn từ OSM/Foursquare, ghép vào
        // popupHtml là chạy được mã trong origin admin (audit bảo mật 23/09/2026).
        popupText: `${poi.name ?? poi.id} · ${poi.distance_m} m`,
      });
    }
    map.addMarker({ lng: plan.point.lng, lat: plan.point.lat, color: COLOR_MOI });
  } else {
    map.addMarker({ lng: plan.before.lng, lat: plan.before.lat, color: COLOR_CU });
    map.addMarker({ lng: plan.after.lng, lat: plan.after.lat, color: COLOR_MOI });
    map.fitBounds(
      [
        Math.min(plan.before.lng, plan.after.lng),
        Math.min(plan.before.lat, plan.after.lat),
        Math.max(plan.before.lng, plan.after.lng),
        Math.max(plan.before.lat, plan.after.lat),
      ],
      56,
    );
  }

  // Đường nối phải chờ style tải xong vì addSource/addLayer đòi thế. Dùng `styledata` chứ KHÔNG
  // dùng `load`: `load` chỉ bắn khi lần render đầu hoàn tất đầy đủ, mà với bộ tiles thiếu ô ở
  // mức phóng đang xem thì nó không bao giờ bắn.
  const veDuongNoi = plan.mode === 'so-sanh' ? plan : null;
  let daVe = false;
  map.gl.on('styledata', () => {
    container.dataset.mapLoaded = '1';
    if (!veDuongNoi || daVe || !map.gl.isStyleLoaded()) return;
    daVe = true;

    map.gl.addSource('duong-noi', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [veDuongNoi.before.lng, veDuongNoi.before.lat],
            [veDuongNoi.after.lng, veDuongNoi.after.lat],
          ],
        },
      },
    });
    map.gl.addLayer({
      id: 'duong-noi',
      type: 'line',
      source: 'duong-noi',
      paint: { 'line-color': COLOR_CU, 'line-width': 2, 'line-dasharray': [2, 2] },
    });
  });

  return map;
}
