import {
  type DirectionsLang,
  type DirectionsResponse,
  decodePolyline6,
  encodePolyline6,
  maneuverKindFromValhalla,
  type Route,
  type RouteLeg,
  type RouteStep,
  type TravelMode,
  type Waypoint,
} from '@mapslibvn/core';
import type {
  ValhallaLeg,
  ValhallaManeuver,
  ValhallaRouteResponse,
  ValhallaTrip,
} from './valhalla';
import { applyViPhrases } from './vi-phrases';

/** Dữ liệu đường là OSM (ODbL); Valhalla (MIT) không yêu cầu ghi nguồn trên UI. */
export const ROUTING_ATTRIBUTION = '© OpenStreetMap contributors';

export interface MergedShape {
  coords: [number, number][];
  /** Chỉ số điểm đầu của từng leg trong `coords`. */
  offsets: number[];
}

const kmToM = (km: number) => Math.round(km * 1000);
const seconds = (s: number) => Math.round(s);

/** Nối shape các leg: điểm cuối leg i trùng điểm đầu leg i+1 → bỏ điểm trùng (spec A mục 5.2). */
export function mergeLegShapes(legs: readonly ValhallaLeg[]): MergedShape {
  const coords: [number, number][] = [];
  const offsets: number[] = [];
  for (const leg of legs) {
    const points = decodePolyline6(leg.shape);
    const drop = coords.length > 0 && points.length > 0 ? 1 : 0;
    offsets.push(coords.length - drop);
    for (let i = drop; i < points.length; i++) {
      const point = points[i];
      if (point) coords.push(point);
    }
  }
  return { coords, offsets };
}

function pointAt(coords: readonly [number, number][], index: number): [number, number] {
  return coords[index] ?? coords[coords.length - 1] ?? [0, 0];
}

const patchVi = (step: RouteStep): RouteStep => ({
  ...step,
  instruction: applyViPhrases(step.instruction),
  verbal_alert: step.verbal_alert === null ? null : applyViPhrases(step.verbal_alert),
  verbal_pre: step.verbal_pre === null ? null : applyViPhrases(step.verbal_pre),
  verbal_post: step.verbal_post === null ? null : applyViPhrases(step.verbal_post),
});

function translateManeuver(
  m: ValhallaManeuver,
  offset: number,
  coords: readonly [number, number][],
  lang: DirectionsLang,
): RouteStep {
  const kind = maneuverKindFromValhalla(m.type);
  const begin = m.begin_shape_index + offset;
  const step: RouteStep = {
    kind,
    instruction: m.instruction,
    verbal_alert: m.verbal_transition_alert_instruction ?? null,
    verbal_pre: m.verbal_pre_transition_instruction ?? null,
    verbal_post: m.verbal_post_transition_instruction ?? null,
    street_names: m.street_names ?? [],
    distance_m: kmToM(m.length),
    duration_s: seconds(m.time),
    shape_begin: begin,
    shape_end: m.end_shape_index + offset,
    location: pointAt(coords, begin),
    roundabout_exit: kind === 'roundabout_enter' ? (m.roundabout_exit_count ?? null) : null,
  };
  return lang === 'vi' ? patchVi(step) : step;
}

export function translateTrip(
  trip: ValhallaTrip,
  mode: TravelMode,
  merged: MergedShape = mergeLegShapes(trip.legs),
  lang: DirectionsLang = 'vi',
): Route {
  const legs: RouteLeg[] = trip.legs.map((leg, i) => {
    const offset = merged.offsets[i] ?? 0;
    return {
      distance_m: kmToM(leg.summary.length),
      duration_s: seconds(leg.summary.time),
      shape_offset: offset,
      steps: leg.maneuvers.map((m) => translateManeuver(m, offset, merged.coords, lang)),
    };
  });
  const s = trip.summary;
  return {
    mode,
    distance_m: kmToM(s.length),
    duration_s: seconds(s.time),
    bbox: [s.min_lon, s.min_lat, s.max_lon, s.max_lat],
    geometry: encodePolyline6(merged.coords),
    legs,
    flags: {
      toll: Boolean(s.has_toll),
      highway: Boolean(s.has_highway),
      ferry: Boolean(s.has_ferry),
    },
  };
}

/** Valhalla trả toạ độ gốc; `snapped` là điểm đầu leg tương ứng (điểm cuối tuyến cho waypoint cuối). */
export function translateWaypoints(trip: ValhallaTrip, merged: MergedShape): Waypoint[] {
  return trip.locations.map((loc, i) => {
    const index = i < merged.offsets.length ? (merged.offsets[i] ?? 0) : merged.coords.length - 1;
    return {
      location: [loc.lon, loc.lat],
      snapped: merged.coords[index] ?? [loc.lon, loc.lat],
      name: null,
    };
  });
}

export function translateDirections(
  json: ValhallaRouteResponse,
  mode: TravelMode,
  graph: string | null,
  lang: DirectionsLang = 'vi',
): DirectionsResponse {
  const merged = mergeLegShapes(json.trip.legs);
  const primary = translateTrip(json.trip, mode, merged, lang);
  const alternates = (json.alternates ?? []).map((a) =>
    translateTrip(a.trip, mode, undefined, lang),
  );
  return {
    routes: [primary, ...alternates],
    waypoints: translateWaypoints(json.trip, merged),
    attribution: ROUTING_ATTRIBUTION,
    engine: { name: 'valhalla', graph },
  };
}
