/** Kiểu dữ liệu Places API (spec 6.1) dùng chung cho Worker và SDK. */
import type { PoiSource } from './poi-sources';

export interface PlaceCategory {
  code: string;
  group: string;
  name_vi: string;
  name_en: string;
}

export interface PlaceAddress {
  housenumber?: string;
  street?: string;
  ward?: string;
  province?: string;
  text?: string;
}

export interface Place {
  id: string;
  name: string;
  category: PlaceCategory | null;
  lat: number;
  lng: number;
  address: PlaceAddress;
  contact?: Record<string, unknown> | null;
  hours?: unknown;
  quality_score: number | null;
  status: 'active' | 'closed' | 'pending' | 'rejected';
  updated_at: string;
}

export interface PlaceSource {
  source: PoiSource;
  source_id: string;
  role: 'primary' | 'secondary';
}

export interface PlaceDetails extends Place {
  sources: PlaceSource[];
  attribution: { text: string; html: string };
}

export type GeocodePrecision =
  | 'rooftop'
  | 'alley'
  | 'interpolated'
  | 'street'
  | 'ward'
  | 'district'
  | 'province';

export type AutocompleteType = 'poi' | 'street' | 'address' | 'area';

export interface AutocompleteItem {
  type: AutocompleteType;
  id?: string;
  name: string;
  secondary: string;
  lat: number;
  lng: number;
  precision?: GeocodePrecision;
  score: number;
  bbox?: [number, number, number, number];
  /** Tên thay thế (OSM `alt_name`/`old_name`) đã khớp truy vấn, ví dụ "Công Lý" (spec 6.3). */
  matched_alt?: string;
}

export interface GeocodeMatched {
  housenumber?: string;
  street?: string;
  ward?: string;
  province?: string;
  former?: { ward?: string; district?: string; province?: string };
}

export interface GeocodeItem {
  lat: number;
  lng: number;
  precision: GeocodePrecision;
  confidence: number;
  matched: GeocodeMatched;
  display_name: string;
  bbox?: [number, number, number, number];
}

export interface ReverseAddress {
  approx_housenumber?: string;
  street?: string;
  ward?: string;
  province?: string;
  display_name: string;
}

export interface ReverseResponse {
  address: ReverseAddress;
  nearest_poi: Place | null;
}

export type EditKind = 'create' | 'update' | 'close' | 'reopen' | 'report';

/** Trường được phép sửa/khai khi đóng góp (spec 6.1 + 6.5). */
export interface EditChanges {
  name?: string;
  lat?: number;
  lng?: number;
  category?: string;
  housenumber?: string;
  street?: string;
  ward?: string;
  province?: string;
  address_text?: string;
  contact?: { phone?: string[]; website?: string[]; facebook?: string; email?: string[] };
  /** Chuỗi opening_hours OSM hoặc {osm: chuỗi}. */
  hours?: string | { osm: string };
}

export interface SuggestEditRequest {
  /** Bắt buộc trừ kind='create'. */
  poi_id?: string;
  kind: EditKind;
  changes?: EditChanges;
  photo_url?: string;
  note?: string;
  /** Chuỗi ổn định theo người dùng cuối do app nhúng cấp — server chỉ lưu bản băm. */
  end_user_token: string;
}

export interface SuggestEditResponse {
  edit_id: number;
  status: 'pending' | 'auto_approved';
  /** POI đích; với kind='create' là id POI mới (pending cho tới khi được duyệt). */
  poi_id: string | null;
}

/** POI đọc từ tile lớp `poi` khi người dùng bấm — SDK web và React Native dùng chung. */
export interface PoiFeature {
  id: string;
  name: string;
  category: string;
  group: string;
  lngLat: [number, number];
}

/** Phương tiện cho `GET /v1/directions` (spec dẫn đường A). */
export type TravelMode = 'motorbike' | 'car' | 'walk';
export type DirectionsLang = 'vi' | 'en';

/** Loại bước rẽ theo tập cố định của MapsLibVN — không phụ thuộc engine. */
export type ManeuverKind =
  | 'depart'
  | 'arrive'
  | 'continue'
  | 'slight_right'
  | 'slight_left'
  | 'turn_right'
  | 'turn_left'
  | 'sharp_right'
  | 'sharp_left'
  | 'uturn_right'
  | 'uturn_left'
  | 'ramp_straight'
  | 'ramp_right'
  | 'ramp_left'
  | 'exit_right'
  | 'exit_left'
  | 'keep_right'
  | 'keep_left'
  | 'merge'
  | 'merge_right'
  | 'merge_left'
  | 'roundabout_enter'
  | 'roundabout_exit'
  | 'ferry_enter'
  | 'ferry_exit'
  | 'elevator'
  | 'steps'
  | 'escalator'
  | 'building_enter'
  | 'building_exit'
  | 'other';

export interface RouteStep {
  kind: ManeuverKind;
  instruction: string;
  /** Câu rẽ ngắn gọn để đọc lúc còn cách xa (spec B); Valhalla không trả → null. */
  verbal_alert: string | null;
  verbal_pre: string | null;
  verbal_post: string | null;
  street_names: string[];
  distance_m: number;
  duration_s: number;
  /** Chỉ số điểm trong polyline của CẢ tuyến (đã dịch qua các leg). */
  shape_begin: number;
  shape_end: number;
  /** [lng, lat] điểm bắt đầu bước. */
  location: [number, number];
  /** Số lối ra khi `kind = roundabout_enter`, còn lại null. */
  roundabout_exit: number | null;
}

export interface RouteLeg {
  distance_m: number;
  duration_s: number;
  /** Chỉ số điểm đầu của leg trong polyline tuyến. */
  shape_offset: number;
  steps: RouteStep[];
}

export interface Route {
  mode: TravelMode;
  distance_m: number;
  duration_s: number;
  /** [minLng, minLat, maxLng, maxLat] */
  bbox: [number, number, number, number];
  /** polyline6 của cả tuyến — giải mã bằng `decodePolyline6` → `[lng, lat][]`. */
  geometry: string;
  legs: RouteLeg[];
  flags: { toll: boolean; highway: boolean; ferry: boolean };
}

export interface Waypoint {
  /** [lng, lat] điểm người dùng gửi. */
  location: [number, number];
  /** [lng, lat] điểm trên tuyến gần nhất (đầu leg tương ứng). */
  snapped: [number, number];
  name: string | null;
}

export interface DirectionsResponse {
  routes: Route[];
  waypoints: Waypoint[];
  attribution: string;
  /** Thông tin chẩn đoán, không phải hợp đồng ổn định. */
  engine?: { name: string; graph: string | null };
}

/** `GET /v1/matrix` (spec 22/09/2026 mục 4.1). Toạ độ `[lng, lat]`; ô `null` là không nối được. */
export interface MatrixResponse {
  mode: TravelMode;
  /** Toạ độ bạn gửi, theo thứ tự gửi, đổi sang [lng, lat]. */
  sources: [number, number][];
  targets: [number, number][];
  /** durations_s[i][j]: giây từ sources[i] tới targets[j]. */
  durations_s: (number | null)[][];
  /** distances_m[i][j]: mét; null cùng ô với durations_s. */
  distances_m: (number | null)[][];
  attribution: string;
  /** Thông tin chẩn đoán, không phải hợp đồng ổn định. */
  engine?: { name: string; graph: string | null };
}

/** `GET /v1/optimized-route` (spec 22/09/2026 mục 4.2): tuyến đầy đủ cộng thứ tự ghé. */
export interface OptimizedRouteResponse extends DirectionsResponse {
  /** Chỉ số vào mảng `stops` bạn gửi, theo thứ tự nên đi; `waypoints` và `legs` đã xếp theo đó. */
  order: number[];
}

/** Một xe trong `POST /v1/fleet-plan` (spec 23/09/2026 mục 4.1). Toạ độ `[lat, lng]`. */
export interface FleetVehicle {
  /** Chuỗi 1–64 ký tự, duy nhất trong `vehicles`. */
  id: string;
  start: [number, number];
  /** Bỏ trống = về lại `start`; `'open'` = kết thúc ở đơn cuối. */
  end?: [number, number] | 'open';
  /** Sức chứa (một chiều, số nguyên). Một xe có thì mọi xe phải có. */
  capacity?: number;
  /** Tối đa đơn cho xe này, 1–10; mặc định 10. */
  max_jobs?: number;
  /**
   * Giờ làm [sớm nhất rời start, muộn nhất kết thúc], ISO 8601 kèm múi giờ. Có khung giờ ở bất kỳ
   * đâu trong request thì mọi xe phải có.
   */
  time_window?: [string, string];
}

/** Một đơn trong `POST /v1/fleet-plan`. */
export interface FleetJob {
  id: string;
  location: [number, number];
  /** Khối lượng, mặc định 0; `> 0` chỉ khi các xe có `capacity`. */
  demand?: number;
  /** Thời gian dừng tại điểm, giây (0–7.200). */
  service_s?: number;
  /** 0–100: đơn ưu tiên được xếp trước khi không đủ chỗ. */
  priority?: number;
  /** 1–3 khung giờ khách nhận, ISO 8601 kèm múi giờ. */
  time_windows?: [string, string][];
}

export interface FleetPlanOptions {
  /** 1–5 xe. */
  vehicles: FleetVehicle[];
  /** 1–30 đơn, tổng không quá tổng `max_jobs` các xe. */
  jobs: FleetJob[];
  /** Một phương tiện cho cả đội; mặc định máy chủ `motorbike`. */
  mode?: TravelMode;
  lang?: DirectionsLang;
}

/** Một điểm ghé trong lịch của xe. `arrival_at` chỉ có ở chế độ tuyệt đối (mọi xe có `time_window`). */
export interface FleetStop {
  job: string;
  /** Giây kể từ lúc xe rời `start`. */
  arrival_s: number;
  arrival_at?: string;
  /** Chờ tới khung giờ khách, giây. */
  waiting_s: number;
  service_s: number;
}

/** Kế hoạch một xe: `DirectionsResponse` đầy đủ (vẽ và dẫn đường được ngay) cộng đơn, lịch, tải. */
export interface FleetVehiclePlan extends DirectionsResponse {
  vehicle: string;
  /** Id đơn theo thứ tự ghé; rỗng = xe nghỉ (khi đó `routes`/`waypoints` rỗng). */
  jobs: string[];
  stops: FleetStop[];
  /** Tổng `demand` các đơn được giao; 0 khi không dùng sức chứa. */
  load: number;
  /** Giây từ lúc rời start tới lúc kết thúc (tới `end`, hoặc xong đơn cuối khi open-end). */
  finish_s: number;
  departure_at?: string;
  finish_at?: string;
}

/** `POST /v1/fleet-plan` (spec 23/09/2026 mục 4.4). */
export interface FleetPlanResponse {
  mode: TravelMode;
  /** Theo thứ tự `vehicles` bạn gửi, kể cả xe không được giao đơn. */
  vehicles: FleetVehiclePlan[];
  /** Đơn không xếp được (hết chỗ, quá sức chứa, khung giờ không thoả). */
  unassigned: { id: string }[];
  summary: {
    vehicles_used: number;
    jobs_assigned: number;
    jobs_unassigned: number;
    /** Tổng `routes[0]` các xe (tuyến thật từ /route). */
    distance_m: number;
    duration_s: number;
    /** Tổng dừng và chờ theo lịch bộ giải. */
    service_s: number;
    waiting_s: number;
  };
  attribution: string;
  /** Thông tin chẩn đoán, không phải hợp đồng ổn định. */
  engine?: { name: string; graph: string | null };
}
