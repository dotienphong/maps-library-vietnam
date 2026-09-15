import { MapsLibVNError } from './errors';
import {
  DEFAULT_POI_SOURCES,
  normalizePoiSources,
  type PoiSource,
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
  /** Kho lưu receipt bền vững. Mobile nên truyền adapter AsyncStorage/SecureStore. */
  receiptStore?: QuotaReceiptStore;
}

export interface QuotaReceipt {
  id: string;
  token: string;
  version: string;
  /** ISO UTC do máy chủ cấp. Quá hạn thì ACK chắc chắn trượt, khỏi gọi cho tốn vòng mạng. */
  expiresAt: string;
}

export interface QuotaReceiptStore {
  /** Mọi receipt còn chờ ACK. Hai request song song sinh hai receipt nên đây là danh sách. */
  load(): Promise<QuotaReceipt[]>;
  save(receipt: QuotaReceipt): Promise<void>;
  remove(receiptId: string): Promise<void>;
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
  error?: {
    code?: string;
    message?: string;
    request_id?: string;
    details?: Record<string, unknown>;
  };
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
  const receiptStore = options.receiptStore ?? defaultReceiptStore(baseUrl, options.apiKey);
  let queue: QuotaReceipt[] = [];
  let loaded = false;
  // Chuỗi tuần tự hoá ACK: hai response về cùng lúc vẫn ACK lần lượt, không nuốt receipt của nhau.
  let chain: Promise<boolean> = Promise.resolve(true);

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    // Đặt cờ TRƯỚC khi đọc: kho hỏng (private mode, quota đầy) thì coi như không có receipt chờ
    // và đi tiếp, chứ không chặn mọi request của khách vì một lỗi lưu trữ.
    loaded = true;
    try {
      queue = [...(await receiptStore.load())];
    } catch {
      queue = [];
    }
  }

  async function forget(receiptId: string): Promise<void> {
    try {
      await receiptStore.remove(receiptId);
    } catch {
      // Không ACK lại được thì cũng không nên làm hỏng request đang phục vụ khách.
    }
  }

  /** true = không còn receipt nào chờ. Không bao giờ ném: lỗi mạng trả false để thử lại sau. */
  async function flushOnce(): Promise<boolean> {
    await ensureLoaded();
    while (queue.length > 0) {
      const receipt = queue[0] as QuotaReceipt;
      // Receipt quá hạn thì máy chủ chắc chắn trả 409; bỏ thẳng, đỡ một vòng mạng và không
      // để nó chặn request đang phục vụ khách. Receipt hết hạn vốn không bị tính lượt.
      if (isExpired(receipt, Date.now())) {
        queue.shift();
        await forget(receipt.id);
        continue;
      }
      let response: Response;
      try {
        response = await doFetch(
          new URL(`${baseUrl}/v1/quota/receipts/${encodeURIComponent(receipt.id)}/ack`),
          {
            method: 'POST',
            headers: { ...baseHeaders(), 'content-type': 'application/json' },
            body: JSON.stringify({ token: receipt.token }),
          },
        );
      } catch {
        return false;
      }
      try {
        await response.arrayBuffer();
      } catch {
        // Body của ACK không quan trọng.
      }
      // 403/404/409 là kết cục vĩnh viễn (token sai, receipt đã đóng hoặc đã hết hạn): giữ lại chỉ
      // làm SDK kẹt mãi. Receipt hết hạn không bị tính lượt, nên bỏ đi là phía khách có lợi.
      if (response.ok || isTerminalAckStatus(response.status)) {
        queue.shift();
        await forget(receipt.id);
        continue;
      }
      return false;
    }
    return true;
  }

  function flushPending(): Promise<boolean> {
    chain = chain.then(flushOnce, flushOnce);
    return chain;
  }

  async function requireNoPendingAck(): Promise<void> {
    if (loaded && queue.length === 0) return;
    if (await flushPending()) return;
    if (await flushPending()) return;
    throw new MapsLibVNError(
      503,
      'quota_ack_pending',
      'Chưa xác nhận được lượt API trước; hãy thử lại khi kết nối ổn định',
    );
  }

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
        parseRetryAfter(response.headers.get('retry-after')),
        body.error?.details,
      );
    }
    const body = (await response.json()) as T;
    const receipt = receiptFrom(response.headers);
    if (receipt) {
      await ensureLoaded();
      queue.push(receipt);
      if (queue.length > MAX_PENDING_RECEIPTS) queue.splice(0, queue.length - MAX_PENDING_RECEIPTS);
      try {
        await receiptStore.save(receipt);
      } catch {
        // Ghi kho hỏng thì vẫn ACK được từ hàng đợi trong RAM của phiên này.
      }
      void flushPending();
    }
    return body;
  }

  async function get<T>(
    path: string,
    params: Record<string, string | number | undefined> = {},
    init?: { signal?: AbortSignal },
  ): Promise<T> {
    await requireNoPendingAck();
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
    await requireNoPendingAck();
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

const RECEIPT_STORAGE_PREFIX = 'mapslibvn:quota:';
/** Chặn hàng đợi phình vô hạn khi mạng hỏng dài; receipt quá lease cũng đã vô giá trị. */
const MAX_PENDING_RECEIPTS = 20;
const TERMINAL_ACK_STATUS = new Set([403, 404, 409]);

function isTerminalAckStatus(status: number): boolean {
  return TERMINAL_ACK_STATUS.has(status);
}

function receiptFrom(headers: Headers): QuotaReceipt | null {
  const id = headers.get('x-mapslibvn-receipt-id');
  const token = headers.get('x-mapslibvn-receipt-token');
  const version = headers.get('x-mapslibvn-receipt-version');
  const expiresAt = headers.get('x-mapslibvn-receipt-expires-at');
  if (!id || !token || version !== '1' || !expiresAt) return null;
  return Number.isFinite(Date.parse(expiresAt)) ? { id, token, version, expiresAt } : null;
}

/** Hết hạn theo đồng hồ máy chủ; đồng hồ client lệch thì chỉ khiến ACK thừa, không tính sai lượt. */
function isExpired(receipt: QuotaReceipt, now: number): boolean {
  const deadline = Date.parse(receipt.expiresAt);
  return Number.isFinite(deadline) && deadline <= now;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/** Kho khoá-giá trị tối thiểu; khớp sẵn AsyncStorage, expo-secure-store và localStorage. */
export interface ReceiptKeyValueStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<unknown> | unknown;
  removeItem(key: string): Promise<unknown> | unknown;
}

/**
 * Dựng kho receipt bền vững từ một kho khoá-giá trị có sẵn của app. React Native và Node không có
 * `localStorage` nên mặc định chỉ giữ receipt trong RAM — mất khi app khởi động lại, và mỗi receipt
 * mất là một lần thiếu ACK. App mobile nên truyền:
 *
 * ```ts
 * import AsyncStorage from '@react-native-async-storage/async-storage';
 * createClient({ apiKey, receiptStore: createReceiptStore(AsyncStorage) });
 * ```
 *
 * Tách thành factory thay vì phụ thuộc thẳng vào AsyncStorage để SDK không thêm peer dependency.
 */
export function createReceiptStore(
  storage: ReceiptKeyValueStorage,
  namespace = 'default',
): QuotaReceiptStore {
  const storageKey = `${RECEIPT_STORAGE_PREFIX}${namespace}`;
  const read = async (): Promise<QuotaReceipt[]> => {
    const raw = await storage.getItem(storageKey);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as QuotaReceipt[]) : [];
    } catch {
      return [];
    }
  };
  const write = async (list: readonly QuotaReceipt[]): Promise<void> => {
    if (list.length === 0) await storage.removeItem(storageKey);
    else await storage.setItem(storageKey, JSON.stringify(list.slice(-MAX_PENDING_RECEIPTS)));
  };
  return {
    load: read,
    save: async (receipt) => {
      await write([...(await read()).filter((item) => item.id !== receipt.id), receipt]);
    },
    remove: async (receiptId) => {
      await write((await read()).filter((item) => item.id !== receiptId));
    },
  };
}

function memoryReceiptStore(): QuotaReceiptStore {
  let list: QuotaReceipt[] = [];
  let warned = false;
  return {
    load: async () => [...list],
    save: async (receipt) => {
      if (!warned) {
        warned = true;
        console.warn(
          '[mapslibvn] Receipt quota đang giữ trong RAM nên sẽ mất khi app khởi động lại, và mỗi' +
            ' receipt mất là một lần thiếu ACK. Truyền kho bền vững:' +
            ' createClient({ receiptStore: createReceiptStore(AsyncStorage) }).',
        );
      }
      list = [...list.filter((item) => item.id !== receipt.id), receipt];
    },
    remove: async (receiptId) => {
      list = list.filter((item) => item.id !== receiptId);
    },
  };
}

/**
 * `localStorage` dùng được thật hay không. Trả null khi thiếu API, khi bị chặn site data, hoặc khi
 * Safari private mode cho đọc nhưng ném lúc ghi.
 */
function usableLocalStorage(): Storage | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    const probe = `${RECEIPT_STORAGE_PREFIX}probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

function defaultReceiptStore(baseUrl: string, apiKey: string): QuotaReceiptStore {
  const storage = usableLocalStorage();
  if (!storage) return memoryReceiptStore();
  // Khoá chỉ để tách namespace giữa các client, không phải ranh giới bảo mật — nên dùng tiền tố
  // công khai của API key thay vì băm. `crypto.subtle` KHÔNG tồn tại ngoài secure context
  // (ví dụ trang http://192.168.x.x khi thử trên máy thật), băm ở đây sẽ làm chết cả SDK.
  const storageKey = `${RECEIPT_STORAGE_PREFIX}${baseUrl}:${apiKey.slice(0, 17)}`;
  const read = (): QuotaReceipt[] => {
    const raw = storage.getItem(storageKey);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as QuotaReceipt[]) : [];
    } catch {
      return [];
    }
  };
  const write = (list: readonly QuotaReceipt[]): void => {
    if (list.length === 0) storage.removeItem(storageKey);
    else storage.setItem(storageKey, JSON.stringify(list.slice(-MAX_PENDING_RECEIPTS)));
  };
  return {
    load: async () => read(),
    save: async (receipt) => {
      write([...read().filter((item) => item.id !== receipt.id), receipt]);
    },
    remove: async (receiptId) => {
      write(read().filter((item) => item.id !== receiptId));
    },
  };
}

export type MapsLibVNClient = ReturnType<typeof createClient>;
