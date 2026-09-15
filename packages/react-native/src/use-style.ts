import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import {
  hidePoiLayer,
  type Lang,
  localizeStyle,
  type MapsLibVNClient,
  type Theme,
} from '@mapslibvn/core';
import { useEffect, useState } from 'react';

export interface StyleOptions {
  /** 'light' | 'dark' hoặc URL style tuỳ biến */
  style: Theme | string;
  lang: Lang;
  poiLayer: boolean;
  /**
   * Style JSON app tự đóng gói sẵn (A2). Có giá trị → KHÔNG gọi mạng lần nào: dùng thẳng JSON này,
   * vẫn áp `lang`/`poiLayer` như style tải từ server. Dành cho app muốn bản đồ hiện ngay khi mở,
   * không phải chờ một vòng HTTP tới Worker trước khi vẽ được gì.
   */
  styleJson?: StyleSpecification;
}

export type ResolvedStyle =
  | { status: 'loading' }
  | { status: 'ready'; mapStyle: string | StyleSpecification }
  | { status: 'error'; error: Error };

export const isTheme = (s: string): s is Theme => s === 'light' || s === 'dark';

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
 * Cache style JSON đã tải, theo URL, sống theo tiến trình app (A1). Không có cache này thì mỗi lần
 * `<MapsLibVNMap>` mount lại với `lang ≠ 'vi'` hoặc `poiLayer={false}` đều tải lại style từ đầu —
 * rời màn hình bản đồ rồi quay lại là một vòng HTTP nữa trước khi vẽ được gì.
 *
 * Chỉ cache JSON THÔ (chưa biến đổi): `lang`/`poiLayer` đổi thì `transformStyle` chạy lại trên JSON
 * đã có, không cần mạng. Giới hạn vài mục vì style là object lớn (hàng trăm kB) — thực tế chỉ có
 * light/dark nên không bao giờ chạm trần.
 */
const STYLE_CACHE_MAX = 4;
const styleCache = new Map<string, StyleSpecification>();

/** Ghi vào cache, đẩy mục cũ nhất ra khi đầy. */
function rememberStyle(url: string, json: StyleSpecification): void {
  if (styleCache.size >= STYLE_CACHE_MAX) {
    const oldest = styleCache.keys().next();
    if (!oldest.done) styleCache.delete(oldest.value);
  }
  styleCache.set(url, json);
}

/**
 * Xoá cache style. App hầu như không cần gọi — chỉ hữu ích khi style trên server đổi mà tiến trình
 * app vẫn sống, hoặc để cô lập test.
 */
export function clearStyleCache(): void {
  styleCache.clear();
}

/**
 * Kết quả `transformStyle` theo (JSON gốc, lang, poiLayer). Hai việc cùng lúc: khỏi chạy lại phép
 * biến đổi trên object hàng trăm kB mỗi lần effect chạy, và giữ NGUYÊN tham chiếu kết quả để
 * `sameResolved` bỏ qua được render thừa. WeakMap → mục tự mất khi JSON gốc bị thu hồi.
 */
const transformedStyles = new WeakMap<StyleSpecification, Map<string, StyleSpecification>>();

function transformCached<T extends StyleSpecification>(
  json: T,
  o: { lang: Lang; poiLayer: boolean },
): T {
  let byOptions = transformedStyles.get(json);
  if (!byOptions) {
    byOptions = new Map();
    transformedStyles.set(json, byOptions);
  }
  const key = `${o.lang}|${o.poiLayer}`;
  const hit = byOptions.get(key);
  if (hit) return hit as T;
  const out = transformStyle(json, o);
  byOptions.set(key, out);
  return out;
}

/**
 * Kết quả có ngay, không cần mạng: style app đóng gói sẵn, style không cần biến đổi (native tự tải
 * URL), hoặc JSON đã nằm trong cache. `null` = phải fetch.
 */
function resolveSync(
  url: string,
  o: { lang: Lang; poiLayer: boolean },
  styleJson: StyleSpecification | undefined,
): ResolvedStyle | null {
  const transform = needsTransform(o);
  if (styleJson) {
    return { status: 'ready', mapStyle: transform ? transformCached(styleJson, o) : styleJson };
  }
  if (!transform) return { status: 'ready', mapStyle: url };
  const cached = styleCache.get(url);
  return cached ? { status: 'ready', mapStyle: transformCached(cached, o) } : null;
}

/**
 * Hai kết quả coi như một để React bỏ qua render thừa. Cần vì nhánh "có ngay" chạy lại mỗi lần
 * effect chạy, mà `doFetch`/`styleJson` truyền inline sẽ đổi tham chiếu mỗi render — không có
 * chốt này thì setState → render → effect → setState thành vòng lặp vô tận.
 */
function sameResolved(a: ResolvedStyle, b: ResolvedStyle): boolean {
  if (a.status !== b.status) return false;
  if (a.status === 'ready' && b.status === 'ready') return a.mapStyle === b.mapStyle;
  if (a.status === 'error' && b.status === 'error') return a.error === b.error;
  return a.status === 'loading';
}

/**
 * Trả URL ngay khi không cần biến đổi; có `styleJson` hoặc đã cache thì trả object ngay, không đi
 * mạng; còn lại mới fetch JSON, biến đổi thuần, trả object. `doFetch` tiêm được cho test.
 */
export function useResolvedStyle(
  places: MapsLibVNClient,
  options: StyleOptions,
  doFetch: typeof globalThis.fetch = globalThis.fetch,
): ResolvedStyle {
  const url = styleUrlFor(places, options.style);
  const _transform = needsTransform(options);
  const { lang, poiLayer, styleJson } = options;
  const [state, setState] = useState<ResolvedStyle>(
    () => resolveSync(url, options, styleJson) ?? { status: 'loading' },
  );

  useEffect(() => {
    const sync = resolveSync(url, { lang, poiLayer }, styleJson);
    if (sync) {
      setState((prev) => (sameResolved(prev, sync) ? prev : sync));
      return;
    }
    let cancelled = false;
    setState((prev) => (prev.status === 'loading' ? prev : { status: 'loading' }));
    (async () => {
      try {
        const res = await doFetch(url);
        if (!res.ok) throw new Error(`Không tải được style (HTTP ${res.status})`);
        const json = (await res.json()) as StyleSpecification;
        rememberStyle(url, json);
        if (!cancelled) {
          setState({
            status: 'ready',
            mapStyle: transformCached(json, { lang, poiLayer }),
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
  }, [url, lang, poiLayer, styleJson, doFetch]);

  return state;
}
