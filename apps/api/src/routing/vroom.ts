import type { Env } from '../env';
import { ApiError } from '../errors';
import { routingHeaders } from './valhalla';

/** VROOM giải + ma trận Valhalla; cộng FLEET_ROUTE_TIMEOUT_MS vẫn dưới trần 30 s của handler thương mại. */
export const FLEET_TIMEOUT_MS = 18_000;
/** `/route` từng xe chạy song song sau khi VROOM trả. */
export const FLEET_ROUTE_TIMEOUT_MS = 8_000;
/** Bài tí hon cho /healthz/fleet và cron: có người đang ngồi đợi màn hình. */
export const FLEET_HEALTH_TIMEOUT_MS = 6_000;

/** Body vroom-express (docs/API.md của VROOM 1.15): toạ độ [lon, lat], id số nguyên, thời gian giây. */
export interface VroomVehicle {
  id: number;
  /** Truyền nguyên văn làm `costing` của Valhalla: auto | motor_scooter | pedestrian. */
  profile: string;
  start: [number, number];
  /** Bỏ = open-end (kết thúc ở đơn cuối). */
  end?: [number, number];
  capacity?: number[];
  max_tasks: number;
  time_window?: [number, number];
}
export interface VroomJob {
  id: number;
  location: [number, number];
  service: number;
  delivery?: number[];
  priority: number;
  time_windows?: [number, number][];
}
export interface VroomRequest {
  vehicles: VroomVehicle[];
  jobs: VroomJob[];
}
export interface VroomStep {
  type: 'start' | 'job' | 'pickup' | 'delivery' | 'break' | 'end';
  /** Giây: tương đối từ 0 khi không có khung giờ, UNIX giây khi có. */
  arrival: number;
  duration: number;
  service?: number;
  waiting_time?: number;
  id?: number;
  location?: [number, number];
  load?: number[];
}
export interface VroomRoute {
  vehicle: number;
  steps: VroomStep[];
  cost: number;
  service: number;
  duration: number;
  waiting_time: number;
}
export interface VroomSummary {
  cost: number;
  routes: number;
  unassigned: number;
  service: number;
  duration: number;
  waiting_time: number;
}
export interface VroomResponse {
  /** 0 ok · 1 lỗi trong · 2 lỗi đầu vào · 3 lỗi định tuyến · 4 quá cỡ (vroom-express). */
  code: number;
  error?: string;
  summary?: VroomSummary;
  unassigned?: { id: number; location?: [number, number] }[];
  routes?: VroomRoute[];
}

type FleetEnv = Pick<
  Env,
  'FLEET_BASE' | 'ROUTING_ACCESS_CLIENT_ID' | 'ROUTING_ACCESS_CLIENT_SECRET'
>;

export function fleetBase(env: Pick<Env, 'FLEET_BASE'>): string {
  const base = env.FLEET_BASE?.replace(/\/+$/, '');
  if (!base) {
    throw new ApiError(503, 'upstream_unavailable', 'Chưa cấu hình bộ giải đội xe (FLEET_BASE)');
  }
  return base;
}

const khongPhanHoi = () =>
  new ApiError(503, 'upstream_unavailable', 'Bộ giải đội xe không phản hồi');
const duLieuSai = () =>
  new ApiError(503, 'upstream_unavailable', 'Bộ giải đội xe trả dữ liệu không hợp lệ');
const UNFOUND = /Unfound route\(s\)/i;
/** VROOM chuyển nguyên lỗi ma trận của Valhalla khi các điểm ở vùng đường không nối nhau (đo 23/09/2026). */
const UNCONNECTED = /unconnected regions/i;

/**
 * Bảng lỗi spec 23/09/2026 mục 4.5, đối chiếu với vroom-express thật ngày 23/09: 413 (code 4) khi quá
 * `limit`/`maxlocations`/`maxvehicles`; 400 (code 2) khi đầu vào sai; 500 cho lỗi định tuyến (code 3,
 * "Unfound route(s) from location [lon,lat]") và lỗi trong (code 1). `noRouteMessage` do fleet.ts
 * cung cấp để gọi tên đơn/xe từ toạ độ trong thông điệp.
 */
export function mapVroomError(
  status: number,
  body: VroomResponse | null,
  noRouteMessage?: (error: string) => string,
): ApiError {
  const error = body?.error ?? '';
  if (status === 413) {
    return new ApiError(400, 'invalid_request', 'Yêu cầu quá cỡ với bộ giải đội xe');
  }
  if (status === 400) {
    return new ApiError(
      400,
      'invalid_request',
      `Bộ giải từ chối yêu cầu (mã ${body?.code ?? 2})${error ? `: ${error}` : ''}`,
    );
  }
  if (body?.code === 3 && UNFOUND.test(error)) {
    return new ApiError(
      404,
      'no_route',
      noRouteMessage ? noRouteMessage(error) : 'Có điểm không tới được bằng mạng đường',
    );
  }
  if (body?.code === 3 && UNCONNECTED.test(error)) {
    return new ApiError(
      404,
      'no_route',
      'Có điểm nằm ở vùng mạng đường không nối với các điểm còn lại',
    );
  }
  // Không đưa thông điệp của VROOM ra ngoài (có thể lộ tên máy trong mạng nội bộ), nhưng PHẢI ghi
  // vào log: Observability chỉ giữ stack, thiếu dòng này thì 503 không cho biết hỏng vì gì.
  console.warn(`[fleet] vroom HTTP ${status} code ${body?.code ?? '?'}: ${error || '(không có)'}`);
  return khongPhanHoi();
}

interface CallOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  noRouteMessage?: (error: string) => string;
}

/**
 * POST `{FLEET_BASE}/` (baseurl `/fleet/` của vroom-express). Cùng header Access với Valhalla vì cùng
 * hostname Tunnel; `redirect: 'manual'` để 302 của Access không dẫn tới trang đăng nhập.
 */
export async function callVroom(
  env: FleetEnv,
  body: VroomRequest,
  options: CallOptions = {},
): Promise<VroomResponse> {
  const base = fleetBase(env);
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${base}/`, {
      method: 'POST',
      headers: routingHeaders(env, base),
      body: JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? FLEET_TIMEOUT_MS),
    });
  } catch {
    throw khongPhanHoi();
  }
  let json: VroomResponse | null = null;
  try {
    json = (await response.json()) as VroomResponse;
  } catch {
    json = null;
  }
  if (!response.ok) throw mapVroomError(response.status, json, options.noRouteMessage);
  if (json?.code !== 0 || !Array.isArray(json.routes)) throw duLieuSai();
  return json;
}
