import { ApiError } from './errors';
import type { ItemType } from './ranking';

export interface LatLng {
  lat: number;
  lng: number;
}

/** "lat,lng" → {lat,lng}; undefined/rỗng → null; sai → 400 invalid_request. */
export function parseLatLngPair(raw: string | undefined, name: string): LatLng | null {
  if (raw === undefined || raw === '') return null;
  const match = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(raw.trim());
  const lat = match ? Number(match[1]) : Number.NaN;
  const lng = match ? Number(match[2]) : Number.NaN;
  if (!match || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new ApiError(400, 'invalid_request', `${name} phải là "lat,lng" hợp lệ`);
  }
  return { lat, lng };
}

export function clampInt(
  raw: string | undefined,
  min: number,
  max: number,
  dflt: number,
  name: string,
): number {
  if (raw === undefined || raw === '') return dflt;
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new ApiError(400, 'invalid_request', `${name} phải là số nguyên`);
  }
  return Math.max(min, Math.min(max, value));
}

const TYPES: ItemType[] = ['poi', 'street', 'address'];

export function parseTypes(raw: string | undefined): Set<ItemType> {
  if (!raw) return new Set(TYPES);
  const parts = raw.split(',').map((value) => value.trim()) as ItemType[];
  for (const part of parts) {
    if (!TYPES.includes(part)) {
      throw new ApiError(400, 'invalid_request', `types chỉ nhận ${TYPES.join(',')}`);
    }
  }
  return new Set(parts);
}

/** "minLng,minLat,maxLng,maxLat" → tuple; sai → 400. */
export function parseBbox(raw: string | undefined): [number, number, number, number] | null {
  if (!raw) return null;
  const fields = raw.split(',').map((value) => value.trim());
  const parts = fields.map(Number);
  if (parts.length !== 4 || fields.some((value) => value === '') || parts.some(Number.isNaN)) {
    throw new ApiError(400, 'invalid_request', 'bbox phải là "minLng,minLat,maxLng,maxLat"');
  }
  const bbox = parts as [number, number, number, number];
  const [minLng, minLat, maxLng, maxLat] = bbox;
  if (
    Math.abs(minLng) > 180 ||
    Math.abs(maxLng) > 180 ||
    Math.abs(minLat) > 90 ||
    Math.abs(maxLat) > 90 ||
    minLng >= maxLng ||
    minLat >= maxLat
  ) {
    throw new ApiError(400, 'invalid_request', 'bbox có biên hoặc thứ tự không hợp lệ');
  }
  return bbox;
}
