import type { DirectionsOptions } from '../client';
import type {
  DirectionsLang,
  DirectionsResponse,
  Route,
  RouteStep,
  TravelMode,
  Waypoint,
} from '../types';

/** Một điểm định vị. Lớp dán (web/RN) đổi từ API nền tảng sang dạng này. */
export interface GeoFix {
  lng: number;
  lat: number;
  /** Bán kính sai số (m). Thiếu → coi là 10 m. */
  accuracy_m?: number;
  /** Độ so với bắc, thuận chiều kim đồng hồ; null/undefined khi đứng yên hoặc không có. */
  heading?: number | null;
  speed_mps?: number | null;
  /** ms epoch — nguồn thời gian duy nhất của máy trạng thái. */
  timestamp: number;
}

/** Nguồn tuyến. `MapsLibVNClient` của `createClient` thoả kiểu này không cần bọc. */
export interface RouteProvider {
  directions(opts: DirectionsOptions): Promise<DirectionsResponse>;
}

export interface PositionError {
  code: 'denied' | 'unavailable' | 'timeout';
  message: string;
  raw?: unknown;
}

/** Nguồn vị trí do lớp dán cung cấp; core chỉ định nghĩa kiểu để web và RN cùng hình. */
export interface PositionSource {
  subscribe(onFix: (fix: GeoFix) => void, onError?: (error: PositionError) => void): () => void;
}

export type NavigationStatus =
  | 'idle'
  | 'navigating'
  | 'off_route'
  | 'rerouting'
  | 'arrived'
  | 'stopped';

export interface NavigationThresholds {
  /** Ngưỡng lệch cơ sở; hiệu dụng = max(offRoute_m, 1.5 × accuracy_m). */
  offRoute_m: number;
  /** Số fix liên tiếp ngoài ngưỡng để xác nhận lệch. */
  offRouteFixes: number;
  /** … và đã kéo dài ít nhất bấy nhiêu giây (theo timestamp fix). */
  offRouteSeconds: number;
  /** Fix kém hơn thì bỏ, không cập nhật gì. */
  maxAccuracy_m: number;
  /** Đọc "Trong X nữa, …" khi còn ≤. */
  approach_m: number;
  /** Đọc câu rẽ khi còn ≤. */
  pre_m: number;
  /** Bán kính đến nơi / qua điểm via. */
  arrive_m: number;
  rerouteCooldown_s: number;
  rerouteMaxFailures: number;
}

/** Số khởi điểm theo spec B mục 4.3; chốt lại sau thực địa (Task 20). */
export const NAVIGATION_THRESHOLDS: Readonly<Record<TravelMode, NavigationThresholds>> = {
  walk: {
    offRoute_m: 25,
    offRouteFixes: 3,
    offRouteSeconds: 5,
    maxAccuracy_m: 60,
    approach_m: 40,
    pre_m: 15,
    arrive_m: 15,
    rerouteCooldown_s: 15,
    rerouteMaxFailures: 3,
  },
  motorbike: {
    offRoute_m: 40,
    offRouteFixes: 3,
    offRouteSeconds: 5,
    maxAccuracy_m: 100,
    approach_m: 200,
    pre_m: 50,
    arrive_m: 25,
    rerouteCooldown_s: 15,
    rerouteMaxFailures: 3,
  },
  car: {
    offRoute_m: 50,
    offRouteFixes: 3,
    offRouteSeconds: 5,
    maxAccuracy_m: 100,
    approach_m: 400,
    pre_m: 80,
    arrive_m: 30,
    rerouteCooldown_s: 15,
    rerouteMaxFailures: 3,
  },
};

export interface NavigationProgress {
  status: NavigationStatus;
  route: Route;
  routeIndex: number;
  legIndex: number;
  /** Chỉ số step PHẲNG qua mọi leg (spec B 4.4). */
  stepIndex: number;
  step: RouteStep;
  /** Step có điểm rẽ kế tiếp; null khi step hiện tại là arrive cuối. */
  nextStep: RouteStep | null;
  /** [lng, lat] điểm đã bám lên tuyến. */
  snapped: [number, number];
  /** Hướng đi (độ): heading GPS khi speed_mps > 1, còn không thì hướng đoạn tuyến. */
  bearing: number;
  /** Chỉ số đỉnh đầu của đoạn polyline đang ở. */
  shapeIndex: number;
  traveled_m: number;
  remaining_m: number;
  /** ETA: phần còn lại của step hiện tại theo tỉ lệ + tổng duration các step sau. */
  remaining_s: number;
  /** Tới điểm rẽ của nextStep; 0 khi không còn. */
  distanceToStep_m: number;
  /** Khoảng cách vuông góc từ fix tới tuyến. */
  offRoute_m: number;
  fix: GeoFix;
}

export interface Announcement {
  text: string;
  kind: 'depart' | 'post' | 'approach' | 'pre' | 'arrive';
  stepIndex: number;
  /** 3 = câu rẽ / đến nơi / khởi hành, 2 = "Trong X nữa", 1 = verbal_post. */
  priority: 1 | 2 | 3;
}

export interface NavigationEvents {
  status: { status: NavigationStatus; previous: NavigationStatus };
  progress: NavigationProgress;
  step: { stepIndex: number; step: RouteStep };
  waypoint: { legIndex: number; waypoint: Waypoint };
  offRoute: { distance_m: number; fix: GeoFix };
  reroute: { reason: 'off_route' | 'manual'; response: DirectionsResponse };
  rerouteFailed: { error: unknown; attempts: number; final: boolean };
  announce: Announcement;
  arrive: { waypoint: Waypoint; fix: GeoFix };
}

export interface NavigatorOptions {
  response: DirectionsResponse;
  /** Mặc định 0. */
  routeIndex?: number;
  /** Bắt buộc khi `reroute` là 'auto' (mặc định). */
  provider?: RouteProvider;
  /** Mặc định 'auto'. */
  reroute?: 'auto' | 'manual';
  /** Mặc định 'vi'; dùng cho câu "Trong X nữa" và request tính lại. */
  lang?: DirectionsLang;
  thresholds?: Partial<NavigationThresholds>;
}

export interface Navigator {
  readonly status: NavigationStatus;
  readonly progress: NavigationProgress | null;
  /** Đồng bộ. Fix kém accuracy hoặc timestamp không tăng bị bỏ. */
  update(fix: GeoFix): void;
  /** Thay tuyến: reset bước, lịch đọc, bộ đếm lệch; fix kế tiếp bám trên toàn tuyến. */
  setRoute(response: DirectionsResponse, routeIndex?: number): void;
  /** Gọi provider ngay (bỏ cooldown và trần lỗi). */
  reroute(): Promise<void>;
  stop(): void;
  on<K extends keyof NavigationEvents>(event: K, handler: (e: NavigationEvents[K]) => void): void;
  off<K extends keyof NavigationEvents>(event: K, handler: (e: NavigationEvents[K]) => void): void;
}
