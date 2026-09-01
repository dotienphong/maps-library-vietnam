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
  | 'province';

export type AutocompleteType = 'poi' | 'street' | 'address';

export interface AutocompleteItem {
  type: AutocompleteType;
  id?: string;
  name: string;
  secondary: string;
  lat: number;
  lng: number;
  precision?: GeocodePrecision;
  score: number;
}

export interface GeocodeMatched {
  housenumber?: string;
  street?: string;
  ward?: string;
  province?: string;
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
