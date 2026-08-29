import { fillTemplate } from '@mapslibvn/style';
import dark from '@mapslibvn/style/templates/dark';
import light from '@mapslibvn/style/templates/light';
import type { Manifest } from './manifest';

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
const TEMPLATES: Record<Theme, string> = {
  light: JSON.stringify(light),
  dark: JSON.stringify(dark),
};

export function isTheme(s: string): s is Theme {
  return (THEMES as readonly string[]).includes(s);
}

export function renderStyle(theme: Theme, manifest: Manifest, tilesBase: string): string {
  const filled = fillTemplate(TEMPLATES[theme], {
    TILES_BASE: tilesBase.replace(/\/+$/, ''),
    VN_FILE: manifest.vn ?? '',
    POI_FILE: manifest.poi ?? '',
  });
  if (manifest.poi) return filled;
  // Chưa có bản POI: bỏ nguồn + lớp poi để MapLibre không tải file rỗng
  const style = JSON.parse(filled) as {
    sources: Record<string, unknown>;
    layers: { source?: string }[];
  };
  const { poi: _dropped, ...sources } = style.sources;
  return JSON.stringify({
    ...style,
    sources,
    layers: style.layers.filter((l) => l.source !== 'poi'),
  });
}
