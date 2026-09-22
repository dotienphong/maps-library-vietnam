import { useEffect, useRef, useState } from 'react';
import type { EditDetail, NearbyPoi } from './api';
import { createMapOnto } from './map-runtime';

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

type LoadMap = (
  container: HTMLElement,
  plan: MapPlan,
  onError: (message: string) => void,
) => Promise<void>;

/**
 * Nạp trễ maplibre-gl: nó nặng (~1 MB), mà phần lớn đóng góp không cần bản đồ. Danh sách không
 * bao giờ kéo theo nó, và nhánh `khong-ve` cũng không.
 */
const defaultLoadMap: LoadMap = async (container, plan, onError) => {
  if (plan.mode === 'khong-ve') return;
  // Nạp trễ: SDK kéo theo maplibre-gl (~1 MB), mà phần lớn đóng góp không cần bản đồ. Danh sách
  // không bao giờ kéo theo nó, và nhánh `khong-ve` cũng không.
  const [web, maplibre] = await Promise.all([
    import('@mapslibvn/web'),
    import('maplibre-gl'),
    import('maplibre-gl/dist/maplibre-gl.css'),
  ]);
  createMapOnto({ createMap: web.createMap, maplibre }, container, plan, onError);
};

interface EditMapProps {
  detail: EditDetail;
  loadMap?: LoadMap;
}

export function EditMap({ detail, loadMap = defaultLoadMap }: EditMapProps) {
  const plan = mapPlan(detail);
  const ref = useRef<HTMLDivElement>(null);
  const editId = detail.edit.id;
  const [error, setError] = useState<string | null>(null);

  // mapPlan() trả về object mới mỗi lần render, nên khai đủ phụ thuộc sẽ dựng lại bản đồ ở mọi
  // lần render — nuốt mất vị trí phóng to và góc nhìn người dùng vừa chỉnh. Bản đồ chỉ cần dựng
  // lại khi chuyển sang một đóng góp khác.
  // biome-ignore lint/correctness/useExhaustiveDependencies: xem giải thích ngay trên
  useEffect(() => {
    if (plan.mode === 'khong-ve' || !ref.current) return;
    setError(null);
    void loadMap(ref.current, plan, setError).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [editId]);

  if (plan.mode === 'khong-ve') return null;

  return (
    <figure className="m-0">
      <div className="relative">
        <div
          ref={ref}
          className="h-48 w-full overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] sm:h-64"
        />
        {error && (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-[var(--radius-card)] bg-[var(--surface)]/95 px-4 text-center"
          >
            <p className="text-sm font-semibold">Không tải được bản đồ</p>
            <p className="text-xs text-[var(--text-muted)]">{error}</p>
            <p className="text-xs text-[var(--text-muted)]">
              Toạ độ vẫn hiện đầy đủ ở bảng so sánh bên dưới.
            </p>
          </div>
        )}
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)]">
        {plan.mode === 'so-sanh' ? (
          <>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#98a2b3]" /> vị trí cũ
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-accent" /> vị trí mới
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
