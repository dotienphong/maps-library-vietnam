import type { DirectionsOptions } from '../client';
import type { DirectionsLang, DirectionsResponse, Route } from '../types';
import { planAnnouncements } from './announce';
import { bearingDeg, haversineM } from './geometry';
import { type FlatStep, type RouteIndex, buildRouteIndex, progressAt } from './progress';
import { snapToRoute } from './snap';
import {
  type GeoFix,
  NAVIGATION_THRESHOLDS,
  type NavigationEvents,
  type NavigationProgress,
  type NavigationStatus,
  type NavigationThresholds,
  type Navigator,
  type NavigatorOptions,
} from './types';

const DEFAULT_ACCURACY_M = 10;
const WINDOW_BASE_M = 300;
const WINDOW_SPEED_MPS = 40;
const WINDOW_MAX_M = 3000;
/** Gần đích theo chim bay chỉ tính là đến nơi khi còn lại theo tuyến dưới ngần này (tuyến vòng qua đích). */
const ARRIVE_NEAR_REMAINING_M = 150;
/** Dưới vận tốc này heading GPS không tin được → dùng hướng đoạn tuyến. */
const MOVING_SPEED_MPS = 1;

interface RouteState {
  response: DirectionsResponse;
  routeIndex: number;
  route: Route;
  index: RouteIndex;
  th: NavigationThresholds;
}

interface LastFix {
  fix: GeoFix;
  shapeIndex: number;
  along_m: number;
  stepIndex: number;
  legIndex: number;
}

function buildState(
  response: DirectionsResponse,
  routeIndex: number,
  override: Partial<NavigationThresholds> | undefined,
): RouteState {
  const route = response.routes[routeIndex];
  if (!route) throw new Error(`createNavigator: response không có routes[${routeIndex}]`);
  return {
    response,
    routeIndex,
    route,
    index: buildRouteIndex(route),
    th: { ...NAVIGATION_THRESHOLDS[route.mode], ...override },
  };
}

/** Máy trạng thái dẫn đường thuần (spec B mục 4.4–4.5): không DOM, không timer, thời gian từ fix. */
export function createNavigator(opts: NavigatorOptions): Navigator {
  const rerouteMode = opts.reroute ?? 'auto';
  const provider = opts.provider;
  if (rerouteMode === 'auto' && !provider) {
    throw new Error("createNavigator: reroute 'auto' cần provider (ví dụ client của createClient)");
  }
  const lang: DirectionsLang = opts.lang ?? 'vi';

  let rs = buildState(opts.response, opts.routeIndex ?? 0, opts.thresholds);
  let status: NavigationStatus = 'idle';
  let progress: NavigationProgress | null = null;
  let last: LastFix | null = null;
  let maxAlong_m = 0;
  let offCount = 0;
  let offSince: number | null = null;
  let backCount = 0;
  let announced = new Set<string>();
  let rerouteAttempts = 0;
  let lastRerouteAt: number | null = null;
  let inflight = false;
  let rerouteToken = 0;
  let rerouteReason: 'off_route' | 'manual' | null = null;

  const listeners: { [K in keyof NavigationEvents]: Set<(e: NavigationEvents[K]) => void> } = {
    status: new Set(),
    progress: new Set(),
    step: new Set(),
    waypoint: new Set(),
    offRoute: new Set(),
    reroute: new Set(),
    rerouteFailed: new Set(),
    announce: new Set(),
    arrive: new Set(),
  };
  const emit = <K extends keyof NavigationEvents>(k: K, e: NavigationEvents[K]): void => {
    for (const fn of listeners[k]) fn(e);
  };
  const setStatus = (next: NavigationStatus): void => {
    if (next === status) return;
    const previous = status;
    status = next;
    emit('status', { status, previous });
  };

  const resetTracking = (): void => {
    last = null;
    maxAlong_m = 0;
    offCount = 0;
    offSince = null;
    backCount = 0;
    announced = new Set();
  };

  const applyRoute = (response: DirectionsResponse, routeIndex: number): void => {
    rs = buildState(response, routeIndex, opts.thresholds);
    resetTracking();
    progress = null;
  };

  const destinationLatLng = (): [number, number] => {
    const w = rs.response.waypoints[rs.response.waypoints.length - 1];
    const end = rs.index.coords[rs.index.coords.length - 1];
    const [lng, lat] = w ? w.location : (end ?? [0, 0]);
    return [lat, lng];
  };

  const rerouteRequest = (fix: GeoFix, legIndex: number): DirectionsOptions => {
    const via = rs.response.waypoints
      .slice(legIndex + 1, -1)
      .map((w): [number, number] => [w.location[1], w.location[0]]);
    const request: DirectionsOptions = {
      from: [fix.lat, fix.lng],
      to: destinationLatLng(),
      mode: rs.route.mode,
      lang,
      alternatives: false,
    };
    if (via.length > 0) request.via = via;
    return request;
  };

  async function runReroute(
    reason: 'off_route' | 'manual',
    fix: GeoFix,
    legIndex: number,
  ): Promise<void> {
    if (!provider) return;
    const token = ++rerouteToken;
    inflight = true;
    rerouteReason = reason;
    lastRerouteAt = fix.timestamp;
    setStatus('rerouting');
    try {
      const next = await provider.directions(rerouteRequest(fix, legIndex));
      inflight = false;
      // Người dùng đã tự quay lại tuyến, stop(), hoặc setRoute() trong lúc chờ → bỏ kết quả.
      if (token !== rerouteToken || status !== 'rerouting') return;
      rerouteAttempts = 0;
      applyRoute(next, 0);
      setStatus('navigating');
      emit('reroute', { reason, response: next });
    } catch (error) {
      inflight = false;
      if (token !== rerouteToken) return;
      rerouteAttempts += 1;
      if (status === 'rerouting') setStatus('off_route');
      emit('rerouteFailed', {
        error,
        attempts: rerouteAttempts,
        final: rerouteAttempts >= rs.th.rerouteMaxFailures,
      });
    }
  }

  const maybeAutoReroute = (fix: GeoFix, legIndex: number): void => {
    if (rerouteMode !== 'auto' || !provider || inflight) return;
    if (rerouteAttempts >= rs.th.rerouteMaxFailures) return;
    if (lastRerouteAt !== null && fix.timestamp - lastRerouteAt < rs.th.rerouteCooldown_s * 1000) {
      return;
    }
    void runReroute('off_route', fix, legIndex);
  };

  const segmentBearing = (shapeIndex: number): number => {
    const a = rs.index.coords[shapeIndex];
    const b = rs.index.coords[shapeIndex + 1];
    return a && b ? bearingDeg(a, b) : 0;
  };

  function update(fix: GeoFix): void {
    if (status === 'arrived' || status === 'stopped') return;
    const accuracy = fix.accuracy_m ?? DEFAULT_ACCURACY_M;
    if (accuracy > rs.th.maxAccuracy_m) return;
    const prev = last;
    if (prev && fix.timestamp <= prev.fix.timestamp) return;
    if (status === 'idle') setStatus('navigating');

    const dt_s = prev ? (fix.timestamp - prev.fix.timestamp) / 1000 : 0;
    const window_m = Math.min(WINDOW_MAX_M, WINDOW_BASE_M + WINDOW_SPEED_MPS * dt_s);
    const here: [number, number] = [fix.lng, fix.lat];
    // Neo tìm kiếm ở shapeIndex tốt gần nhất đã biết — một fix lệch không được phép làm hỏng neo
    // cho các fix sau (nếu không, cửa sổ có thể bắt nhầm một đoạn gần đó của tuyến ngoằn ngoèo).
    const anchorShapeIndex = prev ? prev.shapeIndex : null;
    const snap = snapToRoute(rs.index, here, {
      fromShapeIndex: anchorShapeIndex,
      window_m,
      heading: fix.heading,
    });
    if (!snap) return;

    // Điểm via trong bán kính đến nơi → coi như đã qua (spec B 4.4). Step "arrive" dài 0 của leg
    // trước đó bị nhảy qua nên không bao giờ là step hiện tại — announce riêng bên dưới.
    let along_m = snap.along_m;
    let skippedViaStep: FlatStep | null = null;
    const currentLeg = prev?.legIndex ?? 0;
    const nextLegBegin = rs.index.legBegin_m[currentLeg + 1];
    const nextVia = rs.response.waypoints[currentLeg + 1];
    if (
      nextLegBegin !== undefined &&
      nextVia &&
      currentLeg + 1 < rs.route.legs.length &&
      along_m < nextLegBegin &&
      haversineM(here, nextVia.snapped) <= rs.th.arrive_m
    ) {
      along_m = nextLegBegin;
      skippedViaStep = rs.index.steps.find((s) => s.legIndex === currentLeg && s.step.kind === 'arrive') ?? null;
    }

    const threshold = Math.max(rs.th.offRoute_m, 1.5 * accuracy);
    const perpendicularOk = snap.distance_m <= threshold;
    // Chạy ngược trên chính tuyến: khoảng cách vuông góc vẫn 0 nhưng along lùi.
    if (perpendicularOk && prev && along_m < maxAlong_m - rs.th.offRoute_m) backCount += 1;
    else backCount = 0;
    const onRoute = perpendicularOk && backCount < rs.th.offRouteFixes;

    if (onRoute) {
      offCount = 0;
      offSince = null;
      maxAlong_m = prev ? Math.max(maxAlong_m, along_m) : along_m;
      if (status === 'off_route' || (status === 'rerouting' && rerouteReason === 'off_route')) {
        rerouteAttempts = 0;
        setStatus('navigating');
      }
    } else {
      offCount += 1;
      offSince ??= fix.timestamp;
      if (
        status === 'navigating' &&
        offCount >= rs.th.offRouteFixes &&
        fix.timestamp - offSince >= rs.th.offRouteSeconds * 1000
      ) {
        setStatus('off_route');
        emit('offRoute', { distance_m: snap.distance_m, fix });
      }
    }

    // Không lùi hiển thị: một fix chạm rồi rời via/mốc xa hơn (đã đi qua) không được kéo
    // step/leg lùi lại — chỉ ảnh hưởng bước/leg hiển thị, không ảnh hưởng phát hiện lệch ở trên.
    const displayAlong_m = Math.max(along_m, maxAlong_m);
    const at = progressAt(rs.index, displayAlong_m);
    const rawFlat = rs.index.steps[at.stepIndex];
    if (!rawFlat) return;
    const rawNextFlat = rs.index.steps[at.stepIndex + 1];

    const moving = (fix.speed_mps ?? 0) > MOVING_SPEED_MPS;
    const bearing =
      moving && typeof fix.heading === 'number' && Number.isFinite(fix.heading)
        ? fix.heading
        : segmentBearing(snap.shapeIndex);

    // Gần đích trong bán kính đến nơi → coi là đã tới step cuối, kể cả khi step hiện tại còn dài
    // hơn arrive_m (nếu không, never thực sự "ở" step arrive vì đã báo đến nơi từ trước đó).
    const end = rs.index.coords[rs.index.coords.length - 1];
    const lastLeg = at.legIndex === rs.route.legs.length - 1;
    const nearEnd =
      end !== undefined &&
      lastLeg &&
      haversineM(here, end) <= rs.th.arrive_m &&
      at.remaining_m <= ARRIVE_NEAR_REMAINING_M;
    const arrivingNow = status === 'navigating' && (at.remaining_m <= rs.th.arrive_m || nearEnd);

    // Lên lịch đọc dựa trên step/next THẬT (chưa snap về step cuối) — nếu không, câu "đến nơi"
    // qua nextStep lookahead (spec B 4.5) sẽ mất khi ngưỡng đọc và ngưỡng đến nơi trùng fix
    // (đi bộ: pre_m === arrive_m).
    const rawStepChanged = prev === null || prev.stepIndex !== at.stepIndex;
    const announceProgress: NavigationProgress = {
      status,
      route: rs.route,
      routeIndex: rs.routeIndex,
      legIndex: at.legIndex,
      stepIndex: at.stepIndex,
      step: rawFlat.step,
      nextStep: rawNextFlat ? rawNextFlat.step : null,
      snapped: snap.point,
      bearing,
      shapeIndex: snap.shapeIndex,
      traveled_m: displayAlong_m,
      remaining_m: at.remaining_m,
      remaining_s: at.remaining_s,
      distanceToStep_m: at.distanceToStep_m,
      offRoute_m: snap.distance_m,
      fix,
    };

    const finalIndex = rs.index.steps.length - 1;
    const finalFlat = rs.index.steps[finalIndex];
    const effectiveAt =
      arrivingNow && finalFlat
        ? {
            stepIndex: finalIndex,
            legIndex: finalFlat.legIndex,
            distanceToStep_m: 0,
            remaining_m: 0,
            remaining_s: 0,
          }
        : at;
    const flat = arrivingNow && finalFlat ? finalFlat : rawFlat;
    const nextFlat = arrivingNow ? undefined : rawNextFlat;
    const stepChanged = prev === null || prev.stepIndex !== effectiveAt.stepIndex;
    const legChanged = prev !== null && effectiveAt.legIndex > prev.legIndex;

    progress = {
      status,
      route: rs.route,
      routeIndex: rs.routeIndex,
      legIndex: effectiveAt.legIndex,
      stepIndex: effectiveAt.stepIndex,
      step: flat.step,
      nextStep: nextFlat ? nextFlat.step : null,
      snapped: snap.point,
      bearing,
      shapeIndex: snap.shapeIndex,
      traveled_m: arrivingNow ? rs.index.total_m : displayAlong_m,
      remaining_m: effectiveAt.remaining_m,
      remaining_s: effectiveAt.remaining_s,
      distanceToStep_m: effectiveAt.distanceToStep_m,
      offRoute_m: snap.distance_m,
      fix,
    };
    last = {
      fix,
      // Neo cửa sổ chỉ đi theo fix ĐANG ở trên tuyến; fix lệch giữ nguyên neo tốt gần nhất.
      shapeIndex: onRoute ? snap.shapeIndex : (anchorShapeIndex ?? snap.shapeIndex),
      along_m: arrivingNow ? rs.index.total_m : displayAlong_m,
      stepIndex: effectiveAt.stepIndex,
      legIndex: effectiveAt.legIndex,
    };

    if (status === 'navigating') {
      if (stepChanged && prev !== null) {
        emit('step', { stepIndex: effectiveAt.stepIndex, step: flat.step });
      }
      if (legChanged) {
        const waypoint = rs.response.waypoints[effectiveAt.legIndex];
        if (waypoint) emit('waypoint', { legIndex: effectiveAt.legIndex, waypoint });
      }
    }
    emit('progress', progress);

    if (status === 'navigating') {
      if (skippedViaStep) {
        const key = `via:${currentLeg}:arrive`;
        const text = skippedViaStep.step.verbal_pre;
        if (text && !announced.has(key)) {
          announced.add(key);
          const viaStepIndex = rs.index.steps.indexOf(skippedViaStep);
          emit('announce', { text, kind: 'arrive', stepIndex: viaStepIndex, priority: 3 });
        }
      }
      for (const a of planAnnouncements(announceProgress, rs.th, lang, announced, rawStepChanged)) {
        emit('announce', a);
      }
      if (arrivingNow) {
        setStatus('arrived');
        progress = { ...progress, status };
        const waypoint = rs.response.waypoints[rs.response.waypoints.length - 1];
        if (waypoint) emit('arrive', { waypoint, fix });
      }
    } else if (status === 'off_route') {
      maybeAutoReroute(fix, effectiveAt.legIndex);
    }
  }

  return {
    get status() {
      return status;
    },
    get progress() {
      return progress;
    },
    update,
    setRoute(response, routeIndex = 0) {
      rerouteToken += 1;
      inflight = false;
      rerouteAttempts = 0;
      lastRerouteAt = null;
      applyRoute(response, routeIndex);
      if (status === 'off_route' || status === 'rerouting') setStatus('navigating');
    },
    async reroute() {
      if (!provider) throw new Error('createNavigator: không có provider để tính lại');
      if (status === 'arrived' || status === 'stopped') return;
      if (!last) throw new Error('createNavigator: chưa có vị trí để tính lại');
      await runReroute('manual', last.fix, last.legIndex);
    },
    stop() {
      rerouteToken += 1;
      inflight = false;
      setStatus('stopped');
    },
    on(event, handler) {
      (listeners[event] as Set<unknown>).add(handler);
    },
    off(event, handler) {
      (listeners[event] as Set<unknown>).delete(handler);
    },
  };
}
