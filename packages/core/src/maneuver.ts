import type { ManeuverKind } from './types';

export const MANEUVER_KINDS: readonly ManeuverKind[] = [
  'depart',
  'arrive',
  'continue',
  'slight_right',
  'slight_left',
  'turn_right',
  'turn_left',
  'sharp_right',
  'sharp_left',
  'uturn_right',
  'uturn_left',
  'ramp_straight',
  'ramp_right',
  'ramp_left',
  'exit_right',
  'exit_left',
  'keep_right',
  'keep_left',
  'merge',
  'merge_right',
  'merge_left',
  'roundabout_enter',
  'roundabout_exit',
  'ferry_enter',
  'ferry_exit',
  'elevator',
  'steps',
  'escalator',
  'building_enter',
  'building_exit',
  'other',
];

/**
 * Mã maneuver Valhalla (0–43, `TripDirections_Maneuver_Type`) → kind MapsLibVN. Đặt ở core để Worker
 * và SDK dùng một bản (spec A mục 6); bảng chỉ là dữ liệu, không phải logic gọi engine.
 * Mã transit 30–36 và 0 (kNone) không có trong bảng → `other`.
 */
export const VALHALLA_MANEUVER_KIND: Readonly<Record<number, ManeuverKind>> = {
  1: 'depart',
  2: 'depart',
  3: 'depart',
  4: 'arrive',
  5: 'arrive',
  6: 'arrive',
  7: 'continue',
  8: 'continue',
  9: 'slight_right',
  10: 'turn_right',
  11: 'sharp_right',
  12: 'uturn_right',
  13: 'uturn_left',
  14: 'sharp_left',
  15: 'turn_left',
  16: 'slight_left',
  17: 'ramp_straight',
  18: 'ramp_right',
  19: 'ramp_left',
  20: 'exit_right',
  21: 'exit_left',
  22: 'continue',
  23: 'keep_right',
  24: 'keep_left',
  25: 'merge',
  26: 'roundabout_enter',
  27: 'roundabout_exit',
  28: 'ferry_enter',
  29: 'ferry_exit',
  37: 'merge_right',
  38: 'merge_left',
  39: 'elevator',
  40: 'steps',
  41: 'escalator',
  42: 'building_enter',
  43: 'building_exit',
};

export function maneuverKindFromValhalla(type: number): ManeuverKind {
  return VALHALLA_MANEUVER_KIND[type] ?? 'other';
}
