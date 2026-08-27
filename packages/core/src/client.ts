import { MapsLibVNError } from './errors';

export type Theme = 'light' | 'dark';

export interface ClientOptions {
  /** Khoá API dạng mlv_live_… */
  apiKey: string;
  /** Gốc API, ví dụ https://maps-api.example.com */
  baseUrl: string;
  /** Cho phép tiêm fetch cho test hoặc môi trường không có global fetch. */
  fetch?: typeof globalThis.fetch;
}

export interface AttributionResponse {
  text: string;
  html: string;
  links: { text: string; href: string; license?: string }[];
}

interface ErrorBody {
  error?: { code?: string; message?: string; request_id?: string };
}

export function createClient(options: ClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function get<T>(
    path: string,
    params: Record<string, string | number | undefined> = {},
  ): Promise<T> {
    const url = new URL(baseUrl + path);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const response = await doFetch(url, {
      headers: { 'X-Api-Key': options.apiKey },
    });
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

  return {
    baseUrl,
    attribution: () => get<AttributionResponse>('/v1/attribution'),
    styleUrl: (theme: Theme) =>
      `${baseUrl}/v1/styles/${theme}.json?key=${encodeURIComponent(options.apiKey)}`,
  };
}

export type MapsLibVNClient = ReturnType<typeof createClient>;
