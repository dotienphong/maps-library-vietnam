import type { DirectionsResponse, RouteStep } from '../../src/types';
import { encodePolyline6 } from '../../src/polyline';

/**
 * Tuyến thẳng hướng bắc 4 đoạn × ~111 m (0,001° vĩ độ), hai leg, via ở đỉnh 2.
 * Leg 0: depart (0→1), turn_left (1→2), arrive-via (2). Leg 1 offset 2: depart (2→3), continue (3→4), arrive (4).
 */
export const SYNTHETIC_COORDS: [number, number][] = [
  [106.7, 10.77],
  [106.7, 10.771],
  [106.7, 10.772],
  [106.7, 10.773],
  [106.7, 10.774],
];

const step = (
  kind: RouteStep['kind'],
  begin: number,
  end: number,
  distance_m: number,
  duration_s: number,
  instruction: string,
): RouteStep => ({
  kind,
  instruction,
  verbal_alert: instruction,
  verbal_pre: instruction,
  verbal_post: distance_m > 0 ? `Tiếp tục đi thêm ${distance_m} mét.` : null,
  street_names: ['Đường Thử'],
  distance_m,
  duration_s,
  shape_begin: begin,
  shape_end: end,
  location: SYNTHETIC_COORDS[begin] ?? [0, 0],
  roundabout_exit: null,
});

export function syntheticTwoLegRoute(): DirectionsResponse {
  return {
    routes: [
      {
        mode: 'walk',
        distance_m: 445,
        duration_s: 320,
        bbox: [106.7, 10.77, 106.7, 10.774],
        geometry: encodePolyline6(SYNTHETIC_COORDS),
        legs: [
          {
            distance_m: 222,
            duration_s: 160,
            shape_offset: 0,
            steps: [
              step('depart', 0, 1, 111, 80, 'Đi về hướng bắc trên Đường Thử.'),
              step('turn_left', 1, 2, 111, 80, 'Rẽ trái vào Đường Thử.'),
              step('arrive', 2, 2, 0, 0, 'Bạn đã đến điểm dừng.'),
            ],
          },
          {
            distance_m: 223,
            duration_s: 160,
            shape_offset: 2,
            steps: [
              step('depart', 2, 3, 111, 80, 'Đi về hướng bắc trên Đường Thử.'),
              step('continue', 3, 4, 112, 80, 'Đi tiếp trên Đường Thử.'),
              step('arrive', 4, 4, 0, 0, 'Điểm đến ở bên phải.'),
            ],
          },
        ],
        flags: { toll: false, highway: false, ferry: false },
      },
    ],
    waypoints: [
      { location: [106.7, 10.77], snapped: [106.7, 10.77], name: null },
      { location: [106.7, 10.772], snapped: [106.7, 10.772], name: null },
      { location: [106.7, 10.774], snapped: [106.7, 10.774], name: null },
    ],
    attribution: '© OpenStreetMap contributors',
  };
}
