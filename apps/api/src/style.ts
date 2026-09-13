import type { PoiSourceProfile } from '@mapslibvn/core';
import { fillTemplate } from '@mapslibvn/style';
import dark from '@mapslibvn/style/templates/dark';
import light from '@mapslibvn/style/templates/light';
import { type Manifest, poiReleaseFor } from './manifest';

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
const TEMPLATES: Record<Theme, string> = {
  light: JSON.stringify(light),
  dark: JSON.stringify(dark),
};

export function isTheme(s: string): s is Theme {
  return (THEMES as readonly string[]).includes(s);
}

export interface RenderedStyle {
  body: string;
  /** Giá trị header `x-poi-profile`: `osm`, `fsq`, `all` hoặc `all;fallback`. */
  profileHeader: string;
}

export function renderStyle(
  theme: Theme,
  manifest: Manifest,
  tilesBase: string,
  profile: PoiSourceProfile = 'all',
): RenderedStyle {
  const poi = poiReleaseFor(manifest, profile);
  const profileHeader = poi.fallback ? 'all;fallback' : profile;
  if (poi.fallback) console.warn(`style: profile ${profile} chưa publish, dùng archive all`);
  const filled = fillTemplate(TEMPLATES[theme], {
    TILES_BASE: tilesBase.replace(/\/+$/, ''),
    VN_FILE: manifest.vn ?? '',
    POI_FILE: poi.release ?? '',
  });
  if (poi.release) return { body: filled, profileHeader };
  // Chưa có bản POI: bỏ nguồn + lớp poi để MapLibre không tải file rỗng
  const style = JSON.parse(filled) as {
    sources: Record<string, unknown>;
    layers: { source?: string }[];
  };
  const { poi: _dropped, ...sources } = style.sources;
  return {
    body: JSON.stringify({
      ...style,
      sources,
      layers: style.layers.filter((l) => l.source !== 'poi'),
    }),
    profileHeader,
  };
}
