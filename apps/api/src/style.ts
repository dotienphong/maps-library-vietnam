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
  return fillTemplate(TEMPLATES[theme], {
    TILES_BASE: tilesBase.replace(/\/+$/, ''),
    VN_FILE: manifest.vn ?? '',
    POI_FILE: manifest.poi ?? '',
  });
}
