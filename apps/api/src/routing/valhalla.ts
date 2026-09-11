import type { DirectionsLang, TravelMode } from '@mapslibvn/core';
import type { Env } from '../env';
import { ApiError } from '../errors';
import type { DirectionsParams } from './params';

export const VALHALLA_COSTING: Readonly<Record<TravelMode, string>> = {
  motorbike: 'motor_scooter',
  car: 'auto',
  walk: 'pedestrian',
};
const VALHALLA_LANGUAGE: Readonly<Record<DirectionsLang, string>> = { vi: 'vi-VN', en: 'en-US' };
export const ROUTE_TIMEOUT_MS = 10_000;
export const STATUS_TIMEOUT_MS = 5_000;

/** Phần JSON Valhalla mà Worker đọc (docs/docs/api/route/api-reference.md của Valhalla 3.8). */
export interface ValhallaManeuver {
  type: number;
  instruction: string;
  verbal_transition_alert_instruction?: string;
  verbal_pre_transition_instruction?: string;
  verbal_post_transition_instruction?: string;
  street_names?: string[];
  time: number;
  /** km (request gửi units=kilometers). */
  length: number;
  begin_shape_index: number;
  end_shape_index: number;
  roundabout_exit_count?: number;
}
export interface ValhallaSummary {
  time: number;
  length: number;
  has_toll?: boolean;
  has_highway?: boolean;
  has_ferry?: boolean;
  min_lat: number;
  min_lon: number;
  max_lat: number;
  max_lon: number;
}
export interface ValhallaLeg {
  summary: ValhallaSummary;
  /** polyline6 */
  shape: string;
  maneuvers: ValhallaManeuver[];
}
export interface ValhallaTrip {
  summary: ValhallaSummary;
  legs: ValhallaLeg[];
  locations: { lat: number; lon: number; street?: string }[];
}
export interface ValhallaRouteResponse {
  trip: ValhallaTrip;
  alternates?: { trip: ValhallaTrip }[];
  id?: string;
}
export interface ValhallaStatus {
  version?: string;
  /** UNIX giây lúc tar/thư mục tile đổi lần cuối. */
  tileset_last_modified?: number;
}
interface ValhallaErrorBody {
  error_code?: number;
  error?: string;
  status_code?: number;
}

type RoutingEnv = Pick<
  Env,
  'ROUTING_BASE' | 'ROUTING_ACCESS_CLIENT_ID' | 'ROUTING_ACCESS_CLIENT_SECRET'
>;

export function valhallaBody(p: DirectionsParams, requestId: string) {
  return {
    locations: p.locations.map(({ lat, lng }) => ({ lat, lon: lng, type: 'break' })),
    costing: VALHALLA_COSTING[p.mode],
    directions_options: { language: VALHALLA_LANGUAGE[p.lang], units: 'kilometers' },
    ...(p.alternatives ? { alternates: 1 } : {}),
    id: requestId,
  };
}

export function routingBase(env: Pick<Env, 'ROUTING_BASE'>): string {
  const base = env.ROUTING_BASE?.replace(/\/+$/, '');
  if (!base)
    throw new ApiError(503, 'upstream_unavailable', 'Chưa cấu hình routing (ROUTING_BASE)');
  return base;
}

/**
 * Header Access chỉ khi đủ cả hai secret (production) VÀ đích là https — không bao giờ gửi service
 * token qua http kể cả khi ai đó cấu hình nhầm ROUTING_BASE. Dev gọi thẳng localhost không header.
 */
export function routingHeaders(
  env: Pick<Env, 'ROUTING_ACCESS_CLIENT_ID' | 'ROUTING_ACCESS_CLIENT_SECRET'>,
  base: string,
): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (
    base.startsWith('https://') &&
    env.ROUTING_ACCESS_CLIENT_ID &&
    env.ROUTING_ACCESS_CLIENT_SECRET
  ) {
    headers['CF-Access-Client-Id'] = env.ROUTING_ACCESS_CLIENT_ID;
    headers['CF-Access-Client-Secret'] = env.ROUTING_ACCESS_CLIENT_SECRET;
  }
  return headers;
}

/** Chỉ HTTP 400 là lỗi đầu vào; Access/engine/lỗi đường dẫn đều là lỗi hạ tầng phía mình. */
export function mapValhallaError(status: number, body: ValhallaErrorBody | null): ApiError {
  if (status === 400 && !body) {
    return new ApiError(503, 'upstream_unavailable', 'Dịch vụ chỉ đường trả dữ liệu không hợp lệ');
  }
  const errorCode = body?.error_code;
  if (status === 400 && (errorCode === 442 || errorCode === 441)) {
    return new ApiError(404, 'no_route', 'Không tìm được đường giữa các điểm');
  }
  if (status === 400 && (errorCode === 170 || errorCode === 171)) {
    return new ApiError(
      404,
      'no_route',
      'Điểm quá xa mạng đường hoặc nằm trong vùng không kết nối',
    );
  }
  if (status === 400) {
    return new ApiError(
      400,
      'invalid_request',
      `Engine từ chối yêu cầu (mã ${errorCode ?? status})`,
    );
  }
  return new ApiError(503, 'upstream_unavailable', 'Dịch vụ chỉ đường không phản hồi');
}

interface CallOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function routingFetch(
  env: RoutingEnv,
  path: '/route' | '/status',
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const base = routingBase(env);
  try {
    return await fetchImpl(`${base}${path}`, {
      ...init,
      headers: routingHeaders(env, base),
      // Access trả 302 khi token sai; không theo redirect sang trang đăng nhập hay URL khác.
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiError(503, 'upstream_unavailable', 'Dịch vụ chỉ đường không phản hồi');
  }
}

export async function callValhalla(
  env: RoutingEnv,
  body: unknown,
  options: CallOptions = {},
): Promise<ValhallaRouteResponse> {
  const response = await routingFetch(
    env,
    '/route',
    { method: 'POST', body: JSON.stringify(body) },
    options.timeoutMs ?? ROUTE_TIMEOUT_MS,
    options.fetchImpl ?? fetch,
  );
  if (!response.ok) {
    let parsed: ValhallaErrorBody | null = null;
    try {
      parsed = (await response.json()) as ValhallaErrorBody;
    } catch {
      // A non-JSON error is still an upstream failure and must not leak to callers.
    }
    throw mapValhallaError(response.status, parsed);
  }
  try {
    return (await response.json()) as ValhallaRouteResponse;
  } catch {
    throw new ApiError(503, 'upstream_unavailable', 'Dịch vụ chỉ đường trả dữ liệu không hợp lệ');
  }
}

export async function fetchValhallaStatus(
  env: RoutingEnv,
  options: CallOptions = {},
): Promise<ValhallaStatus> {
  const response = await routingFetch(
    env,
    '/status',
    { method: 'GET' },
    options.timeoutMs ?? STATUS_TIMEOUT_MS,
    options.fetchImpl ?? fetch,
  );
  if (!response.ok) {
    throw new ApiError(503, 'upstream_unavailable', 'Dịch vụ chỉ đường không phản hồi');
  }
  try {
    return (await response.json()) as ValhallaStatus;
  } catch {
    throw new ApiError(503, 'upstream_unavailable', 'Valhalla /status trả dữ liệu không hợp lệ');
  }
}
