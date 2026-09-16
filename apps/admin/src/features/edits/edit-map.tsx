import { useEffect, useRef } from 'react';
import type { EditDetail, NearbyPoi } from './api';

export interface Point {
  lat: number;
  lng: number;
}

export type MapPlan =
  | { mode: 'khong-ve' }
  | { mode: 'mot-chot'; point: Point; nearby: NearbyPoi[] }
  | { mode: 'so-sanh'; before: Point; after: Point; distanceM: number | null };

/**
 * Bản đồ chỉ xuất hiện khi nó trả lời được câu hỏi người duyệt đang có:
 * - `update` đổi toạ độ → lệch bao xa, về hướng nào
 * - `create` → chỗ này đã có POI nào chưa (bắt trùng lặp)
 * - `close`/`reopen`/`report` → chỗ đó ở đâu
 * - `update` không đổi toạ độ → không câu hỏi nào cần bản đồ, nên không vẽ
 */
export function mapPlan(detail: EditDetail): MapPlan {
  const changes = detail.edit.changes;
  const movedLat = changes && typeof changes.lat === 'number' ? changes.lat : null;
  const movedLng = changes && typeof changes.lng === 'number' ? changes.lng : null;
  const current = detail.poi_hien_tai;

  if (movedLat !== null && movedLng !== null) {
    const after: Point = { lat: movedLat, lng: movedLng };
    // `create` không so sánh được: POI staged nằm đúng toạ độ đề xuất nên hai chốt sẽ chồng nhau.
    if (detail.edit.kind === 'create' || !current) {
      return { mode: 'mot-chot', point: after, nearby: detail.nearby };
    }
    return {
      mode: 'so-sanh',
      before: { lat: current.lat, lng: current.lng },
      after,
      distanceM: detail.distance_m,
    };
  }

  // Tới đây là đóng góp không đụng toạ độ. Với `update` (sửa giờ mở cửa, số điện thoại) bản đồ
  // không trả lời câu hỏi nào — chỉ làm chậm và gây nhiễu. Với đóng cửa / mở lại / báo lỗi thì
  // câu hỏi là "chỗ đó ở đâu", nên vẫn cần một chốt.
  if (current && detail.edit.kind !== 'update') {
    return { mode: 'mot-chot', point: current, nearby: [] };
  }
  return { mode: 'khong-ve' };
}

type LoadMap = (container: HTMLElement, plan: MapPlan) => Promise<void>;

/**
 * Nạp trễ maplibre-gl: nó nặng, mà phần lớn đóng góp không cần bản đồ. Danh sách không bao giờ
 * kéo theo nó, và nhánh `khong-ve` cũng không.
 */
const defaultLoadMap: LoadMap = async (container, plan) => {
  if (plan.mode === 'khong-ve') return;
  const maplibre = await import('maplibre-gl');
  await import('maplibre-gl/dist/maplibre-gl.css');

  const dark = document.documentElement.classList.contains('dark');
  const center: [number, number] =
    plan.mode === 'so-sanh' ? [plan.after.lng, plan.after.lat] : [plan.point.lng, plan.point.lat];

  // Style lấy từ chính API này, đường dẫn tương đối vì admin cùng origin với Worker.
  // /v1/styles/* không đòi khoá nên không phải nhúng khoá vào bundle tĩnh.
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
        new maplibre.Marker({ color: '#98a2b3', scale: 0.7 })
          .setLngLat([poi.lng, poi.lat])
          .setPopup(new maplibre.Popup().setText(`${poi.name ?? poi.id} · ${poi.distance_m} m`))
          .addTo(map);
      }
      new maplibre.Marker({ color: '#1b3a6b' })
        .setLngLat([plan.point.lng, plan.point.lat])
        .addTo(map);
      return;
    }

    new maplibre.Marker({ color: '#98a2b3' })
      .setLngLat([plan.before.lng, plan.before.lat])
      .addTo(map);
    new maplibre.Marker({ color: '#1b3a6b' })
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
      paint: { 'line-color': '#98a2b3', 'line-width': 2, 'line-dasharray': [2, 2] },
    });
    map.fitBounds(
      [
        [Math.min(plan.before.lng, plan.after.lng), Math.min(plan.before.lat, plan.after.lat)],
        [Math.max(plan.before.lng, plan.after.lng), Math.max(plan.before.lat, plan.after.lat)],
      ],
      { padding: 56, maxZoom: 17 },
    );
  });
};

interface EditMapProps {
  detail: EditDetail;
  loadMap?: LoadMap;
}

export function EditMap({ detail, loadMap = defaultLoadMap }: EditMapProps) {
  const plan = mapPlan(detail);
  const ref = useRef<HTMLDivElement>(null);
  const editId = detail.edit.id;

  // mapPlan() trả về object mới mỗi lần render, nên khai đủ phụ thuộc sẽ dựng lại bản đồ ở mọi
  // lần render — nuốt mất vị trí phóng to và góc nhìn người dùng vừa chỉnh. Bản đồ chỉ cần dựng
  // lại khi chuyển sang một đóng góp khác.
  // biome-ignore lint/correctness/useExhaustiveDependencies: xem giải thích ngay trên
  useEffect(() => {
    if (plan.mode === 'khong-ve' || !ref.current) return;
    void loadMap(ref.current, plan);
  }, [editId]);

  if (plan.mode === 'khong-ve') return null;

  return (
    <figure className="m-0">
      <div
        ref={ref}
        className="h-48 w-full overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] sm:h-64"
      />
      <figcaption className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)]">
        {plan.mode === 'so-sanh' ? (
          <>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#98a2b3]" /> vị trí cũ
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-brand-700" /> vị trí mới
            </span>
            {plan.distanceM !== null && (
              <strong className="text-[var(--text)]">Lệch {plan.distanceM} m</strong>
            )}
          </>
        ) : (
          plan.nearby.length > 0 && (
            <span>{plan.nearby.length} POI sẵn có trong bán kính 200 m</span>
          )
        )}
      </figcaption>
    </figure>
  );
}
