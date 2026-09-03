import type { PoiFeature } from '@mapslibvn/core';
import type { Feature } from 'geojson';

/** Feature từ `queryRenderedFeatures` trên lớp `poi` → PoiFeature cùng shape với SDK web. */
export function toPoiFeature(feature: Feature | undefined): PoiFeature | null {
  if (!feature || feature.geometry.type !== 'Point') return null;
  const [lng, lat] = feature.geometry.coordinates;
  if (lng === undefined || lat === undefined) return null;
  const p = (feature.properties ?? {}) as Record<string, unknown>;
  return {
    id: String(p.id ?? feature.id ?? ''),
    name: String(p.name ?? ''),
    category: String(p.cat ?? ''),
    group: String(p.grp ?? ''),
    lngLat: [lng, lat],
  };
}
