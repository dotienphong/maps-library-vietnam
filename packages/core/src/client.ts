import { MapsLibVNError } from './errors';
import {
  DEFAULT_POI_SOURCES,
  type PoiSource,
  normalizePoiSources,
  poiSourcesKey,
} from './poi-sources';
import type {
  AutocompleteItem,
  AutocompleteType,
  DirectionsLang,
  DirectionsResponse,
  GeocodeItem,
  Place,
  PlaceDetails,
  ReverseResponse,
  SuggestEditRequest,
  SuggestEditResponse,
  TravelMode,
} from './types';

export type Theme = 'light' | 'dark';

export interface ClientOptions {
  /** Khoá API dạng mlv_live_… */
  apiKey: string;
  /** Gốc API, ví dụ https://maps-api.example.com */
  baseUrl: string;
  /** Cho phép tiêm fetch cho test hoặc môi trường không có global fetch. */
  fetch?: typeof globalThis.fetch;
  /**
   * Header thêm cho mọi request, ví dụ `X-Bundle-Id` cho khoá `mobile` (spec 6.4).
   * Không ghi đè được `X-Api-Key`.
   */
  headers?: Record<string, string>;
  /**
   * Tập nguồn POI cho bản đồ và Places API (spec 07/09). Mặc định cả hai nguồn `osm` và `fsq`
   * (Overture đã gỡ ở 0.7.0).
   * Áp cho autocomplete/search/nearby/reverse và `styleUrl`; `getPlace`/`geocode` không lọc.
   */
  poiSources?: readonly PoiSource[];
}

export interface AttributionResponse {
  text: string;
  html: string;
  links: { text: string; href: string; license?: string }[];
}

export interface DirectionsOptions {
  /** [lat, lng] — vĩ độ trước, cùng quy ước với `near`. */
  from: [number, number];
  to: [number, number];
  /** Tối đa 5 điểm dừng, mỗi điểm [lat, lng]. */
  via?: [number, number][];
  /** Mặc định máy chủ: `motorbike`. */
  mode?: TravelMode;
  /** Mặc định máy chủ: `vi`. */
  lang?: DirectionsLang;
  /** Xin thêm một tuyến thay thế (bị bỏ qua khi có `via`). */
  alternatives?: boolean;
}

const latLng = ([lat, lng]: readonly [number, number]): string => `${lat},${lng}`;

interface ErrorBody {
  error?: { code?: string; message?: string; request_id?: string };
}

export function createClient(options: ClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const poiSources = normalizePoiSources(options.poiSources ?? DEFAULT_POI_SOURCES);
  if (!poiSources) {
    throw new Error(`poiSources không hợp lệ: ${JSON.stringify(options.poiSources)}`);
  }
  const sources = poiSourcesKey(poiSources);
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const baseHeaders = (): Record<string, string> => ({
    ...(options.headers ?? {}),
    'X-Api-Key': options.apiKey,
  });

  async function parseOrThrow<T>(response: Response): Promise<T> {
    if (!response.ok) {
      let body: ErrorBody = {};
      try {
        body = (await response.json()) as ErrorBody;
      } catch {
        // Body lỗi có thể không phải JSON.
      }
      throw new MapsLibVNError(
        response.status,
        body.error?.code ?? 'http_error',
        body.error?.message ?? `HTTP ${response.status}`,
        body.error?.request_id,
      );
    }
    return (await response.json()) as T;
  }

  async function get<T>(
    path: string,
    params: Record<string, string | number | undefined> = {},
    init?: { signal?: AbortSignal },
  ): Promise<T> {
    const url = new URL(baseUrl + path);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const response = await doFetch(url, {
      headers: baseHeaders(),
      ...(init?.signal ? { signal: init.signal } : {}),
    });
    return parseOrThrow<T>(response);
  }

  async function post<T>(path: string, body: unknown): Promise<T> {
    const response = await doFetch(new URL(baseUrl + path), {
      method: 'POST',
      headers: { ...baseHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return parseOrThrow<T>(response);
  }

  return {
    baseUrl,
    attribution: () => get<AttributionResponse>('/v1/attribution'),
    styleUrl: (theme: Theme) =>
      `${baseUrl}/v1/styles/${theme}.json?key=${encodeURIComponent(options.apiKey)}&sources=${encodeURIComponent(sources)}`,
    autocomplete: (
      q: string,
      opts: {
        near?: [number, number];
        limit?: number;
        types?: AutocompleteType[];
        signal?: AbortSignal;
      } = {},
    ) =>
      get<{ items: AutocompleteItem[] }>(
        '/v1/autocomplete',
        { q, near: opts.near?.join(','), limit: opts.limit, types: opts.types?.join(','), sources },
        opts.signal ? { signal: opts.signal } : undefined,
      ),
    search: (
      q: string,
      opts: {
        category?: string;
        near?: [number, number];
        radius?: number;
        bbox?: [number, number, number, number];
        limit?: number;
        offset?: number;
      } = {},
    ) =>
      get<{ items: Place[]; total: number }>('/v1/search', {
        q,
        category: opts.category,
        near: opts.near?.join(','),
        radius: opts.radius,
        bbox: opts.bbox?.join(','),
        limit: opts.limit,
        offset: opts.offset,
        sources,
      }),
    nearby: (opts: {
      lat: number;
      lng: number;
      radius?: number;
      category?: string;
      limit?: number;
    }) =>
      get<{ items: Place[] }>('/v1/nearby', {
        lat: opts.lat,
        lng: opts.lng,
        radius: opts.radius,
        category: opts.category,
        limit: opts.limit,
        sources,
      }),
    getPlace: (id: string) => get<PlaceDetails>(`/v1/places/${encodeURIComponent(id)}`),
    geocode: (q: string, opts: { near?: [number, number]; limit?: number } = {}) =>
      get<{ items: GeocodeItem[] }>('/v1/geocode', {
        q,
        near: opts.near?.join(','),
        limit: opts.limit,
      }),
    reverse: (lat: number, lng: number) =>
      get<ReverseResponse>('/v1/reverse', { lat, lng, sources }),
    /** Chỉ đường (spec dẫn đường A). Response dùng [lng, lat]; tham số vào dùng [lat, lng]. */
    directions: (opts: DirectionsOptions) =>
      get<DirectionsResponse>('/v1/directions', {
        from: latLng(opts.from),
        to: latLng(opts.to),
        via: opts.via && opts.via.length > 0 ? opts.via.map(latLng).join(';') : undefined,
        mode: opts.mode,
        lang: opts.lang,
        alternatives: opts.alternatives === undefined ? undefined : opts.alternatives ? 1 : 0,
      }),
    /** Gửi đóng góp/sửa POI (spec 6.1). Khoá phải có scope edits:write. */
    suggestEdit: (edit: SuggestEditRequest) => post<SuggestEditResponse>('/v1/edits', edit),
  };
}

export type MapsLibVNClient = ReturnType<typeof createClient>;
