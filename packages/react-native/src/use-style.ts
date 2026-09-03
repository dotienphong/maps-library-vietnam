import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import {
  type Lang,
  type MapsLibVNClient,
  type Theme,
  hidePoiLayer,
  localizeStyle,
} from '@mapslibvn/core';
import { useEffect, useState } from 'react';

export interface StyleOptions {
  /** 'light' | 'dark' hoặc URL style tuỳ biến */
  style: Theme | string;
  lang: Lang;
  poiLayer: boolean;
}

export type ResolvedStyle =
  | { status: 'loading' }
  | { status: 'ready'; mapStyle: string | StyleSpecification }
  | { status: 'error'; error: Error };

const isTheme = (s: string): s is Theme => s === 'light' || s === 'dark';

export function styleUrlFor(places: MapsLibVNClient, style: Theme | string): string {
  return isTheme(style) ? places.styleUrl(style) : style;
}

/** Native tải URL trực tiếp trừ khi phải đổi ngôn ngữ hay ẩn POI (wrapper không có API đổi layout). */
export function needsTransform(o: { lang: Lang; poiLayer: boolean }): boolean {
  return o.lang !== 'vi' || !o.poiLayer;
}

export function transformStyle<T extends StyleSpecification>(
  json: T,
  o: { lang: Lang; poiLayer: boolean },
): T {
  const localized = localizeStyle(json, o.lang);
  return o.poiLayer ? localized : hidePoiLayer(localized);
}

/**
 * Trả URL ngay khi không cần biến đổi; ngược lại fetch JSON, biến đổi thuần, trả object.
 * `doFetch` tiêm được cho test.
 */
export function useResolvedStyle(
  places: MapsLibVNClient,
  options: StyleOptions,
  doFetch: typeof globalThis.fetch = globalThis.fetch,
): ResolvedStyle {
  const url = styleUrlFor(places, options.style);
  const transform = needsTransform(options);
  const [state, setState] = useState<ResolvedStyle>(() =>
    transform ? { status: 'loading' } : { status: 'ready', mapStyle: url },
  );

  useEffect(() => {
    if (!transform) {
      setState({ status: 'ready', mapStyle: url });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    (async () => {
      try {
        const res = await doFetch(url);
        if (!res.ok) throw new Error(`Không tải được style (HTTP ${res.status})`);
        const json = (await res.json()) as StyleSpecification;
        if (!cancelled) {
          setState({
            status: 'ready',
            mapStyle: transformStyle(json, { lang: options.lang, poiLayer: options.poiLayer }),
          });
        }
      } catch (cause) {
        if (!cancelled) {
          setState({
            status: 'error',
            error: cause instanceof Error ? cause : new Error('Không tải được style'),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, transform, options.lang, options.poiLayer, doFetch]);

  return state;
}
