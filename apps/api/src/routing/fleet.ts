import type {
  DirectionsLang,
  DirectionsResponse,
  FleetPlanResponse,
  FleetStop,
  FleetVehiclePlan,
  TravelMode,
} from '@mapslibvn/core';
import { ApiError } from '../errors';
import type { LatLng } from '../params';
import { formatIsoAt, type ParsedTime, parseIsoWithOffset } from './fleet-time';
import { OPTIMIZED_MAX_STOPS } from './optimized';
import {
  assertInVietnam,
  DIRECTIONS_LANGS,
  haversineM,
  MATRIX_MAX_CROW_DISTANCE_M,
  oneOf,
  TRAVEL_MODES,
} from './params';
import { ROUTING_ATTRIBUTION, translateDirections } from './translate';
import { VALHALLA_COSTING, VALHALLA_LANGUAGE, type ValhallaRouteResponse } from './valhalla';
import type { VroomJob, VroomRequest, VroomResponse, VroomRoute, VroomVehicle } from './vroom';

/**
 * Trần cỡ (spec 2026-09-23 mục 4.9): 5 xe + 30 đơn ≤ 40 điểm → ma trận Valhalla ≤ 1.600 cặp, dưới
 * `max_matrix_location_pairs` 2.500. Mỗi xe ≤ 10 đơn = OPTIMIZED_MAX_STOPS = MAX_VIA: tuyến từng xe
 * dẫn đường và tính lại được như tuyến tối ưu một xe. Đổi số ở đây phải đổi docs, site, playground-lib
 * và smoke cùng commit; số cuối chốt theo phép đo production (mục 8).
 */
export const FLEET_MAX_VEHICLES = 5;
export const FLEET_MAX_JOBS = 30;
export const FLEET_MAX_JOBS_PER_VEHICLE = OPTIMIZED_MAX_STOPS;
export const FLEET_MAX_TIME_WINDOWS = 3;
export const FLEET_MAX_SERVICE_S = 7_200;
export const FLEET_MAX_QUANTITY = 1_000_000;
export const FLEET_MAX_PRIORITY = 100;
export const FLEET_MAX_BODY_BYTES = 65_536;
export const FLEET_ID_MAX_LENGTH = 64;
export const FLEET_MAX_WINDOW_S = 86_400;
export const FLEET_MAX_SPAN_S = 172_800;

export interface FleetVehicleParams {
  id: string;
  start: LatLng;
  /** null = open-end (kết thúc ở đơn cuối); mặc định = start. */
  end: LatLng | null;
  capacity: number | null;
  maxJobs: number;
  timeWindow: [ParsedTime, ParsedTime] | null;
}
export interface FleetJobParams {
  id: string;
  location: LatLng;
  demand: number;
  serviceS: number;
  priority: number;
  timeWindows: [ParsedTime, ParsedTime][];
}
export interface FleetParams {
  vehicles: FleetVehicleParams[];
  jobs: FleetJobParams[];
  mode: TravelMode;
  lang: DirectionsLang;
  /** true = mọi xe có time_window: VROOM nhận UNIX giây và response có `*_at` (spec mục 4.3). */
  absoluteTime: boolean;
}

const bad = (message: string) => new ApiError(400, 'invalid_request', message);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function readId(raw: unknown, name: string, seen: Set<string>): string {
  if (typeof raw !== 'string') throw bad(`${name}.id phải là chuỗi`);
  const id = raw.trim();
  if (id.length === 0 || id.length > FLEET_ID_MAX_LENGTH) {
    throw bad(`${name}.id phải dài 1–${FLEET_ID_MAX_LENGTH} ký tự`);
  }
  if (seen.has(id)) throw bad(`${name}.id "${id}" bị trùng`);
  seen.add(id);
  return id;
}

function readLatLng(raw: unknown, name: string): LatLng {
  if (!Array.isArray(raw) || raw.length !== 2) throw bad(`${name} phải là [lat, lng]`);
  const [lat, lng] = raw as unknown[];
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    throw bad(`${name} phải là [lat, lng] hợp lệ`);
  }
  return { lat, lng };
}

function readInt(raw: unknown, name: string, min: number, max: number, dflt: number): number {
  if (raw === undefined) return dflt;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) {
    throw bad(`${name} phải là số nguyên từ ${min} đến ${max}`);
  }
  return raw;
}

function readEnum<T extends string>(raw: unknown, allowed: readonly T[], dflt: T, name: string): T {
  if (raw === undefined) return dflt;
  if (typeof raw !== 'string') throw bad(`${name} chỉ nhận ${allowed.join(', ')}`);
  return oneOf(raw, allowed, dflt, name);
}

function readWindow(raw: unknown, name: string): [ParsedTime, ParsedTime] {
  if (!Array.isArray(raw) || raw.length !== 2) throw bad(`${name} phải là [bắt đầu, kết thúc]`);
  const start = parseIsoWithOffset(raw[0], `${name}[0]`);
  const end = parseIsoWithOffset(raw[1], `${name}[1]`);
  if (start.unix >= end.unix) throw bad(`${name}: bắt đầu phải trước kết thúc`);
  if (end.unix - start.unix > FLEET_MAX_WINDOW_S) {
    throw bad(`${name}: mỗi khung giờ tối đa 24 giờ`);
  }
  return [start, end];
}

/** Đếm TRƯỚC khi parse sâu: mảng nghìn phần tử bị từ chối ở bước đếm, không tốn CPU parse từng cái. */
function countList(raw: unknown, name: string, max: number): unknown[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw bad(`${name} phải là mảng có ít nhất 1 phần tử`);
  }
  if (raw.length > max) throw bad(`${name} tối đa ${max} phần tử (đang ${raw.length})`);
  return raw;
}

interface NamedPoint {
  name: string;
  point: LatLng;
}

/**
 * Mọi cặp điểm ≤ trần chim bay của ma trận theo mode — VROOM xin Valhalla một ma trận vuông, một cặp
 * quá xa là engine từ chối cả request.
 */
function assertFleetCrowDistance(named: readonly NamedPoint[], mode: TravelMode): void {
  const limit = MATRIX_MAX_CROW_DISTANCE_M[mode];
  for (let a = 0; a < named.length; a++) {
    for (let b = a + 1; b < named.length; b++) {
      const pa = named[a];
      const pb = named[b];
      if (!pa || !pb) continue;
      const d = haversineM(pa.point, pb.point);
      if (d > limit) {
        throw bad(
          `${pa.name} và ${pb.name} cách nhau ${Math.round(d / 1000)} km, đội xe ${mode} tối đa ${limit / 1000} km đường chim bay`,
        );
      }
    }
  }
}

/** Kiểm hết ở Worker (spec mục 4.2), 400 không tốn lượt, không gọi VROOM. */
export function parseFleetBody(raw: unknown): FleetParams {
  if (!isRecord(raw)) throw bad('Body phải là JSON object có vehicles và jobs');
  const rawVehicles = countList(raw.vehicles, 'vehicles', FLEET_MAX_VEHICLES);
  const rawJobs = countList(raw.jobs, 'jobs', FLEET_MAX_JOBS);
  const mode = readEnum(raw.mode, TRAVEL_MODES, 'motorbike', 'mode');
  const lang = readEnum(raw.lang, DIRECTIONS_LANGS, 'vi', 'lang');

  const vehicleIds = new Set<string>();
  const vehicles: FleetVehicleParams[] = rawVehicles.map((v, i) => {
    const name = `vehicles[${i}]`;
    if (!isRecord(v)) throw bad(`${name} phải là object`);
    const id = readId(v.id, name, vehicleIds);
    const start = readLatLng(v.start, `${name}.start`);
    let end: LatLng | null = start;
    if (v.end === 'open') end = null;
    else if (v.end !== undefined) end = readLatLng(v.end, `${name}.end`);
    return {
      id,
      start,
      end,
      capacity:
        v.capacity === undefined
          ? null
          : readInt(v.capacity, `${name}.capacity`, 0, FLEET_MAX_QUANTITY, 0),
      maxJobs: readInt(
        v.max_jobs,
        `${name}.max_jobs`,
        1,
        FLEET_MAX_JOBS_PER_VEHICLE,
        FLEET_MAX_JOBS_PER_VEHICLE,
      ),
      timeWindow:
        v.time_window === undefined ? null : readWindow(v.time_window, `${name}.time_window`),
    };
  });

  const jobIds = new Set<string>();
  const jobs: FleetJobParams[] = rawJobs.map((j, i) => {
    const name = `jobs[${i}]`;
    if (!isRecord(j)) throw bad(`${name} phải là object`);
    const id = readId(j.id, name, jobIds);
    const location = readLatLng(j.location, `${name}.location`);
    let timeWindows: [ParsedTime, ParsedTime][] = [];
    if (j.time_windows !== undefined) {
      const list = countList(j.time_windows, `${name}.time_windows`, FLEET_MAX_TIME_WINDOWS);
      timeWindows = list.map((w, k) => readWindow(w, `${name}.time_windows[${k}]`));
    }
    return {
      id,
      location,
      demand: readInt(j.demand, `${name}.demand`, 0, FLEET_MAX_QUANTITY, 0),
      serviceS: readInt(j.service_s, `${name}.service_s`, 0, FLEET_MAX_SERVICE_S, 0),
      priority: readInt(j.priority, `${name}.priority`, 0, FLEET_MAX_PRIORITY, 0),
      timeWindows,
    };
  });

  const named: NamedPoint[] = [];
  for (const v of vehicles) {
    named.push({ name: `xe ${v.id} (start)`, point: v.start });
    if (v.end) named.push({ name: `xe ${v.id} (end)`, point: v.end });
  }
  for (const j of jobs) named.push({ name: `đơn ${j.id}`, point: j.location });
  assertInVietnam(named.map((n) => n.point));
  assertFleetCrowDistance(named, mode);

  const cho = vehicles.reduce((sum, v) => sum + v.maxJobs, 0);
  if (jobs.length > cho) {
    throw bad(
      `${jobs.length} đơn nhưng các xe chỉ nhận tối đa ${cho} (${vehicles.length} xe, max_jobs ${vehicles.map((v) => v.maxJobs).join(' + ')})`,
    );
  }

  const coSucChua = vehicles.some((v) => v.capacity !== null);
  if (coSucChua && vehicles.some((v) => v.capacity === null)) {
    throw bad('Sức chứa là tất cả hoặc không: một xe có capacity thì mọi xe phải có');
  }
  if (!coSucChua && jobs.some((j) => j.demand > 0)) {
    throw bad('Đơn có khối lượng (demand) thì mọi xe phải có sức chứa (capacity)');
  }

  const coKhungGio =
    vehicles.some((v) => v.timeWindow !== null) || jobs.some((j) => j.timeWindows.length > 0);
  if (coKhungGio && vehicles.some((v) => v.timeWindow === null)) {
    throw bad('Có khung giờ thì mọi xe phải có time_window (giờ làm)');
  }
  if (coKhungGio) {
    const moc = [
      ...vehicles.flatMap((v) => v.timeWindow ?? []),
      ...jobs.flatMap((j) => j.timeWindows.flat()),
    ];
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const t of moc) {
      min = Math.min(min, t.unix);
      max = Math.max(max, t.unix);
    }
    if (max - min > FLEET_MAX_SPAN_S) {
      throw bad('Mọi mốc giờ trong request phải nằm trong 48 giờ');
    }
  }

  return { vehicles, jobs, mode, lang, absoluteTime: coKhungGio };
}

const lngLat = ({ lat, lng }: LatLng): [number, number] => [lng, lat];

/** Body vroom-express: id là chỉ số vào mảng của ta (VROOM đòi số nguyên), profile = costing Valhalla. */
export function fleetVroomBody(p: FleetParams): VroomRequest {
  const coSucChua = p.vehicles.some((v) => v.capacity !== null);
  const profile = VALHALLA_COSTING[p.mode];
  return {
    vehicles: p.vehicles.map(
      (v, i): VroomVehicle => ({
        id: i,
        profile,
        start: lngLat(v.start),
        ...(v.end ? { end: lngLat(v.end) } : {}),
        ...(v.capacity !== null ? { capacity: [v.capacity] } : {}),
        max_tasks: v.maxJobs,
        ...(v.timeWindow ? { time_window: [v.timeWindow[0].unix, v.timeWindow[1].unix] } : {}),
      }),
    ),
    jobs: p.jobs.map(
      (j, i): VroomJob => ({
        id: i,
        location: lngLat(j.location),
        service: j.serviceS,
        ...(coSucChua ? { delivery: [j.demand] } : {}),
        priority: j.priority,
        ...(j.timeWindows.length > 0
          ? { time_windows: j.timeWindows.map(([a, b]): [number, number] => [a.unix, b.unix]) }
          : {}),
      }),
    ),
  };
}

/**
 * Khoá cache = sha256 của tham số đã chuẩn hoá: toạ độ làm tròn 4 chữ số (~11 m, cùng bài học với
 * ma trận), giờ dạng UNIX giây. Body POST không có URL để làm khoá nên phải băm.
 */
export async function fleetCacheUrl(p: FleetParams): Promise<string> {
  const r4 = ({ lat, lng }: LatLng): string => `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const tw = (w: [ParsedTime, ParsedTime] | null): [number, number] | null =>
    w ? [w[0].unix, w[1].unix] : null;
  const canonical = JSON.stringify({
    v: 1,
    m: p.mode,
    l: p.lang,
    xe: p.vehicles.map((v) => [
      v.id,
      r4(v.start),
      v.end ? r4(v.end) : 'open',
      v.capacity,
      v.maxJobs,
      tw(v.timeWindow),
    ]),
    don: p.jobs.map((j) => [
      j.id,
      r4(j.location),
      j.demand,
      j.serviceS,
      j.priority,
      j.timeWindows.map(tw),
    ]),
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `https://cache.mapslibvn/fleet-plan?v=1&h=${hex}`;
}

const ENGINE_NAME = 'vroom+valhalla';
const invalidUpstream = () =>
  new ApiError(503, 'upstream_unavailable', 'Bộ giải đội xe trả dữ liệu không hợp lệ');
const isIndex = (v: unknown, n: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < n;

/** Khung kế hoạch từ VROOM, trước khi có tuyến Valhalla. */
export interface FleetVehicleSkeleton {
  index: number;
  /** Chỉ số đơn theo thứ tự ghé. */
  jobIndexes: number[];
  stops: FleetStop[];
  /** Giây: 0 ở chế độ tương đối, UNIX ở chế độ tuyệt đối (start.arrival do VROOM chọn). */
  departureUnix: number;
  finishS: number;
  load: number;
}
export interface FleetSkeleton {
  vehicles: FleetVehicleSkeleton[];
  unassigned: number[];
  serviceS: number;
  waitingS: number;
}

/**
 * VROOM → khung kế hoạch. Không đoán khi dữ liệu lệch: vehicle/id ngoài khoảng, đơn gán hai lần,
 * tổng đơn không khớp, kiểu step ta không gửi (pickup/delivery/break) → 503, không trả kế hoạch sai.
 */
export function translateFleet(json: VroomResponse, p: FleetParams): FleetSkeleton {
  const routes = json.routes;
  if (!Array.isArray(routes)) throw invalidUpstream();
  const nXe = p.vehicles.length;
  const nDon = p.jobs.length;
  const assigned = new Set<number>();
  const byVehicle = new Map<number, VroomRoute>();
  for (const route of routes) {
    if (
      !isIndex(route?.vehicle, nXe) ||
      byVehicle.has(route.vehicle) ||
      !Array.isArray(route.steps)
    ) {
      throw invalidUpstream();
    }
    byVehicle.set(route.vehicle, route);
  }
  const vehicles: FleetVehicleSkeleton[] = p.vehicles.map((v, index) => {
    const route = byVehicle.get(index);
    const offsetMin = v.timeWindow ? v.timeWindow[0].offsetMin : 0;
    if (!route) {
      return {
        index,
        jobIndexes: [],
        stops: [],
        departureUnix: v.timeWindow ? v.timeWindow[0].unix : 0,
        finishS: 0,
        load: 0,
      };
    }
    const first = route.steps[0];
    if (!first || first.type !== 'start' || typeof first.arrival !== 'number') {
      throw invalidUpstream();
    }
    const departure = first.arrival;
    const jobIndexes: number[] = [];
    const stops: FleetStop[] = [];
    let load = 0;
    let finish = 0;
    for (const step of route.steps) {
      if (typeof step.arrival !== 'number') throw invalidUpstream();
      const waiting = step.waiting_time ?? 0;
      const service = step.service ?? 0;
      if (step.type === 'job') {
        if (!isIndex(step.id, nDon) || assigned.has(step.id)) throw invalidUpstream();
        const job = p.jobs[step.id];
        if (!job) throw invalidUpstream();
        assigned.add(step.id);
        jobIndexes.push(step.id);
        load += job.demand;
        stops.push({
          job: job.id,
          arrival_s: step.arrival - departure,
          ...(p.absoluteTime ? { arrival_at: formatIsoAt(step.arrival, offsetMin) } : {}),
          waiting_s: waiting,
          service_s: service,
        });
        finish = step.arrival + waiting + service - departure;
      } else if (step.type === 'end') {
        finish = step.arrival - departure;
      } else if (step.type !== 'start') {
        throw invalidUpstream();
      }
    }
    if (jobIndexes.length > v.maxJobs) throw invalidUpstream();
    return { index, jobIndexes, stops, departureUnix: departure, finishS: finish, load };
  });
  const unassigned: number[] = [];
  for (const u of json.unassigned ?? []) {
    if (!isIndex(u?.id, nDon) || assigned.has(u.id) || unassigned.includes(u.id)) {
      throw invalidUpstream();
    }
    unassigned.push(u.id);
  }
  if (assigned.size + unassigned.length !== nDon) throw invalidUpstream();
  return {
    vehicles,
    unassigned,
    serviceS: json.summary?.service ?? 0,
    waitingS: json.summary?.waiting_time ?? 0,
  };
}

/** Body `POST /route` cho một xe: start, đơn theo thứ tự VROOM, end (bỏ khi open-end). */
export function fleetRouteBody(p: FleetParams, v: FleetVehicleSkeleton, requestId: string) {
  const xe = p.vehicles[v.index];
  if (!xe) throw invalidUpstream();
  const points: LatLng[] = [xe.start];
  for (const i of v.jobIndexes) {
    const job = p.jobs[i];
    if (!job) throw invalidUpstream();
    points.push(job.location);
  }
  if (xe.end) points.push(xe.end);
  return {
    locations: points.map(({ lat, lng }) => ({ lat, lon: lng, type: 'break' })),
    costing: VALHALLA_COSTING[p.mode],
    directions_options: { language: VALHALLA_LANGUAGE[p.lang], units: 'kilometers' },
    id: requestId,
  };
}

/**
 * Ghép khung VROOM với tuyến Valhalla từng xe thành FleetPlanResponse. `routes[k]` là tuyến của xe k
 * (null khi xe rỗi). Số leg phải bằng số đơn (+1 nếu có end) — lệch là dữ liệu hỏng → 503.
 */
export function assembleFleetPlan(
  p: FleetParams,
  skel: FleetSkeleton,
  routes: readonly (ValhallaRouteResponse | null)[],
  graph: string | null,
): FleetPlanResponse {
  let distance = 0;
  let duration = 0;
  let used = 0;
  let assigned = 0;
  const vehicles: FleetVehiclePlan[] = skel.vehicles.map((v) => {
    const xe = p.vehicles[v.index];
    if (!xe) throw invalidUpstream();
    const offsetMin = xe.timeWindow ? xe.timeWindow[0].offsetMin : 0;
    const jobs = v.jobIndexes.map((i) => {
      const job = p.jobs[i];
      if (!job) throw invalidUpstream();
      return job.id;
    });
    let base: DirectionsResponse = {
      routes: [],
      waypoints: [],
      attribution: ROUTING_ATTRIBUTION,
      engine: { name: 'valhalla', graph },
    };
    if (jobs.length > 0) {
      const json = routes[v.index];
      if (!json) throw invalidUpstream();
      base = translateDirections(json, p.mode, graph, p.lang);
      const route = base.routes[0];
      if (!route || route.legs.length !== jobs.length + (xe.end ? 1 : 0)) throw invalidUpstream();
      distance += route.distance_m;
      duration += route.duration_s;
      used += 1;
      assigned += jobs.length;
    }
    return {
      ...base,
      vehicle: xe.id,
      jobs,
      stops: v.stops,
      load: v.load,
      finish_s: v.finishS,
      ...(p.absoluteTime && xe.timeWindow
        ? {
            departure_at: formatIsoAt(v.departureUnix, offsetMin),
            finish_at: formatIsoAt(v.departureUnix + v.finishS, offsetMin),
          }
        : {}),
    };
  });
  return {
    mode: p.mode,
    vehicles,
    unassigned: skel.unassigned.map((i) => ({ id: p.jobs[i]?.id ?? String(i) })),
    summary: {
      vehicles_used: used,
      jobs_assigned: assigned,
      jobs_unassigned: skel.unassigned.length,
      distance_m: distance,
      duration_s: duration,
      service_s: skel.serviceS,
      waiting_s: skel.waitingS,
    },
    attribution: ROUTING_ATTRIBUTION,
    engine: { name: ENGINE_NAME, graph },
  };
}

/**
 * VROOM báo "Unfound route(s) from location [lon,lat]" (VROOM 1.15 in 6 chữ số thập phân) — đối
 * chiếu toạ độ với điểm đã gửi (đơn trước, xe sau) để gọi đúng tên; không khớp thì câu chung. Người
 * gọi soát hết điểm hỏng bằng /v1/matrix 1×N (docs).
 */
export function noRouteMessage(p: FleetParams): (error: string) => string {
  const named: { name: string; lng: number; lat: number }[] = [];
  for (const j of p.jobs) {
    named.push({ name: `đơn ${j.id}`, lng: j.location.lng, lat: j.location.lat });
  }
  for (const v of p.vehicles) {
    named.push({ name: `xe ${v.id} (điểm xuất phát)`, lng: v.start.lng, lat: v.start.lat });
    if (v.end) named.push({ name: `xe ${v.id} (điểm kết thúc)`, lng: v.end.lng, lat: v.end.lat });
  }
  return (error) => {
    const names: string[] = [];
    for (const m of error.matchAll(/\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/g)) {
      const lng = Number(m[1]);
      const lat = Number(m[2]);
      const hit = named.find((n) => Math.abs(n.lng - lng) < 1e-5 && Math.abs(n.lat - lat) < 1e-5);
      if (hit && !names.includes(hit.name)) names.push(hit.name);
    }
    return names.length > 0
      ? `Không tới được bằng mạng đường: ${names.join(', ')}`
      : 'Có điểm không tới được bằng mạng đường';
  };
}
