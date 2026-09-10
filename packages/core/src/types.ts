/** Kiểu dữ liệu Places API (spec 6.1) dùng chung cho Worker và SDK. */
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
  source: 'osm' | 'overture' | 'fsq';
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
  contact?: { phone?: string[]; website?: string[]; facebook?: string };
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
