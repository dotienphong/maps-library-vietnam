import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors';
import {
  assembleFleetPlan,
  FLEET_MAX_JOBS,
  FLEET_MAX_JOBS_PER_VEHICLE,
  FLEET_MAX_VEHICLES,
  fleetCacheUrl,
  fleetRouteBody,
  fleetVroomBody,
  noRouteMessage,
  parseFleetBody,
  translateFleet,
} from '../src/routing/fleet';
import { OPTIMIZED_MAX_STOPS } from '../src/routing/optimized';
import type { ValhallaRouteResponse } from '../src/routing/valhalla';
import type { VroomResponse } from '../src/routing/vroom';
import routeFixture from './fixtures/valhalla/optimized-two-stops.json';
import q1Vroom from './fixtures/vroom/q1-fleet.json';
import q1Request from './fixtures/vroom/q1-fleet-request.json';
import vroomFixture from './fixtures/vroom/two-vehicles.json';

const DEPOT: [number, number] = [10.7725, 106.698]; // Chợ Bến Thành
const HO_CON_RUA: [number, number] = [10.7826, 106.6958];
const NHA_RONG: [number, number] = [10.7686, 106.7069];
const DINH_DOC_LAP: [number, number] = [10.777, 106.6953];
const T0 = '2026-09-24T08:00:00+07:00';
const T1 = '2026-09-24T12:00:00+07:00';

/** Body hợp lệ nhỏ nhất: 2 xe cùng kho (xe-2 open-end), 3 đơn, không ràng buộc giờ. */
const BODY = {
  vehicles: [
    { id: 'xe-1', start: DEPOT },
    { id: 'xe-2', start: DEPOT, end: 'open' },
  ],
  jobs: [
    { id: 'don-1', location: HO_CON_RUA, service_s: 120 },
    { id: 'don-2', location: NHA_RONG, service_s: 120 },
    { id: 'don-3', location: DINH_DOC_LAP },
  ],
};

/** Chế độ tuyệt đối: mọi xe có time_window, đơn 1 có khung giờ, sức chứa 5. */
const BODY_ABS = {
  mode: 'car',
  vehicles: [
    { id: 'xe-1', start: DEPOT, capacity: 5, time_window: [T0, T1] },
    { id: 'xe-2', start: DEPOT, end: 'open', capacity: 5, max_jobs: 2, time_window: [T0, T1] },
  ],
  jobs: [
    {
      id: 'don-1',
      location: HO_CON_RUA,
      demand: 3,
      service_s: 300,
      priority: 50,
      time_windows: [['2026-09-24T09:00:00+07:00', '2026-09-24T10:00:00+07:00']],
    },
    { id: 'don-2', location: NHA_RONG, demand: 2 },
  ],
};

function expect400(action: () => unknown, message: RegExp): void {
  try {
    action();
    throw new Error('phải ném');
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).code).toBe('invalid_request');
    expect((error as ApiError).message).toMatch(message);
  }
}

const voi = (patch: Record<string, unknown>) => ({ ...BODY, ...patch });
const xe = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `xe-${i}`, start: DEPOT }));
const don = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `don-${i}`, location: [10.77 + i * 0.001, 106.69] }));

describe('hằng số', () => {
  it('5 xe, 30 đơn, 10 đơn mỗi xe = OPTIMIZED_MAX_STOPS', () => {
    expect(FLEET_MAX_VEHICLES).toBe(5);
    expect(FLEET_MAX_JOBS).toBe(30);
    expect(FLEET_MAX_JOBS_PER_VEHICLE).toBe(OPTIMIZED_MAX_STOPS);
  });
});

describe('parseFleetBody — mặc định', () => {
  it('end bỏ = về start; "open" = null; capacity null; max_jobs 10; demand/service/priority 0; motorbike/vi; tương đối', () => {
    const p = parseFleetBody(BODY);
    expect(p.mode).toBe('motorbike');
    expect(p.lang).toBe('vi');
    expect(p.absoluteTime).toBe(false);
    expect(p.vehicles[0]).toEqual({
      id: 'xe-1',
      start: { lat: 10.7725, lng: 106.698 },
      end: { lat: 10.7725, lng: 106.698 },
      capacity: null,
      maxJobs: 10,
      timeWindow: null,
    });
    expect(p.vehicles[1]?.end).toBeNull();
    expect(p.jobs[0]).toEqual({
      id: 'don-1',
      location: { lat: 10.7826, lng: 106.6958 },
      demand: 0,
      serviceS: 120,
      priority: 0,
      timeWindows: [],
    });
    expect(p.jobs[2]?.serviceS).toBe(0);
  });

  it('chế độ tuyệt đối: parse ISO thành unix + lệch múi, capacity, max_jobs, priority, mode car', () => {
    const p = parseFleetBody(BODY_ABS);
    expect(p.absoluteTime).toBe(true);
    expect(p.mode).toBe('car');
    expect(p.vehicles[0]?.timeWindow?.[0]).toEqual({
      unix: Date.parse(T0) / 1000,
      offsetMin: 420,
    });
    expect(p.vehicles[0]?.capacity).toBe(5);
    expect(p.vehicles[1]?.maxJobs).toBe(2);
    expect(p.jobs[0]?.timeWindows).toHaveLength(1);
    expect(p.jobs[0]?.priority).toBe(50);
    expect(p.jobs[0]?.demand).toBe(3);
  });
});

describe('parseFleetBody — 400', () => {
  it('body không phải object; thiếu/quá số xe, số đơn', () => {
    expect400(() => parseFleetBody(null), /JSON object/);
    expect400(() => parseFleetBody([]), /JSON object/);
    expect400(() => parseFleetBody(voi({ vehicles: [] })), /vehicles phải là mảng/);
    expect400(() => parseFleetBody(voi({ vehicles: xe(6) })), /vehicles tối đa 5/);
    expect400(() => parseFleetBody(voi({ jobs: [] })), /jobs phải là mảng/);
    expect400(() => parseFleetBody(voi({ vehicles: xe(5), jobs: don(31) })), /jobs tối đa 30/);
  });

  it('id: chuỗi 1–64, duy nhất trong từng danh sách', () => {
    expect400(
      () => parseFleetBody(voi({ vehicles: [{ id: 7, start: DEPOT }] })),
      /vehicles\[0\]\.id/,
    );
    expect400(
      () => parseFleetBody(voi({ vehicles: [{ id: 'a'.repeat(65), start: DEPOT }] })),
      /1–64/,
    );
    expect400(
      () =>
        parseFleetBody(
          voi({
            vehicles: [
              { id: 'x', start: DEPOT },
              { id: 'x', start: DEPOT },
            ],
          }),
        ),
      /bị trùng/,
    );
    // Cùng id ở xe và đơn thì hợp lệ — hai danh sách khác nhau.
    expect(() => parseFleetBody(voi({ vehicles: [{ id: 'don-1', start: DEPOT }] }))).not.toThrow();
  });

  it('toạ độ sai, ngoài Việt Nam, cặp xa hơn trần chim bay theo mode', () => {
    expect400(
      () => parseFleetBody(voi({ vehicles: [{ id: 'x', start: [106.698, 10.7725, 1] }] })),
      /\[lat, lng\]/,
    );
    expect400(() => parseFleetBody(voi({ vehicles: [{ id: 'x', start: ['a', 'b'] }] })), /hợp lệ/);
    expect400(
      () => parseFleetBody(voi({ jobs: [{ id: 'bkk', location: [13.75, 100.5] }] })),
      /Việt Nam/,
    );
    // Hà Nội cách kho HCM ~1.140 km: quá 200 km xe máy, quá 400 km ô tô; thông điệp gọi đúng tên hai điểm.
    expect400(
      () => parseFleetBody(voi({ jobs: [{ id: 'hn', location: [21.0285, 105.8542] }] })),
      /xe xe-1 \(start\) và đơn hn cách nhau 1\d{3} km, đội xe motorbike tối đa 200 km/,
    );
    expect400(
      () =>
        parseFleetBody(voi({ mode: 'car', jobs: [{ id: 'hn', location: [21.0285, 105.8542] }] })),
      /tối đa 400 km/,
    );
  });

  it('mode/lang lạ; số nguyên ngoài khoảng', () => {
    expect400(() => parseFleetBody(voi({ mode: 'bike' })), /mode chỉ nhận/);
    expect400(() => parseFleetBody(voi({ lang: 7 })), /lang/);
    expect400(
      () => parseFleetBody(voi({ vehicles: [{ id: 'x', start: DEPOT, max_jobs: 11 }] })),
      /max_jobs phải là số nguyên từ 1 đến 10/,
    );
    expect400(
      () => parseFleetBody(voi({ vehicles: [{ id: 'x', start: DEPOT, max_jobs: 0 }] })),
      /max_jobs/,
    );
    expect400(
      () => parseFleetBody(voi({ vehicles: [{ id: 'x', start: DEPOT, capacity: 1.5 }] })),
      /capacity/,
    );
    expect400(
      () => parseFleetBody(voi({ jobs: [{ id: 'd', location: HO_CON_RUA, service_s: 7201 }] })),
      /service_s.*0 đến 7200/,
    );
    expect400(
      () => parseFleetBody(voi({ jobs: [{ id: 'd', location: HO_CON_RUA, priority: 101 }] })),
      /priority/,
    );
  });

  it('số đơn vượt tổng max_jobs', () => {
    expect400(
      () => parseFleetBody(voi({ vehicles: [{ id: 'x', start: DEPOT, max_jobs: 2 }] })),
      /3 đơn nhưng các xe chỉ nhận tối đa 2/,
    );
  });

  it('sức chứa tất cả-hoặc-không; demand cần capacity', () => {
    expect400(
      () =>
        parseFleetBody(
          voi({
            vehicles: [
              { id: 'a', start: DEPOT, capacity: 5 },
              { id: 'b', start: DEPOT },
            ],
          }),
        ),
      /mọi xe phải có/,
    );
    expect400(
      () => parseFleetBody(voi({ jobs: [{ id: 'd', location: HO_CON_RUA, demand: 1 }] })),
      /demand.*capacity/,
    );
  });

  it('khung giờ: mọi xe phải có time_window; kèm múi giờ; bắt đầu < kết thúc; ≤ 24 h; trải ≤ 48 h; ≤ 3 khung', () => {
    expect400(
      () =>
        parseFleetBody(
          voi({ jobs: [{ id: 'd', location: HO_CON_RUA, time_windows: [[T0, T1]] }] }),
        ),
      /mọi xe phải có time_window/,
    );
    expect400(
      () =>
        parseFleetBody(
          voi({
            vehicles: [{ id: 'a', start: DEPOT, time_window: ['2026-09-24T08:00:00', T1] }],
          }),
        ),
      /múi giờ/,
    );
    expect400(
      () => parseFleetBody(voi({ vehicles: [{ id: 'a', start: DEPOT, time_window: [T1, T0] }] })),
      /bắt đầu phải trước kết thúc/,
    );
    expect400(
      () =>
        parseFleetBody(
          voi({
            vehicles: [{ id: 'a', start: DEPOT, time_window: [T0, '2026-09-25T08:00:01+07:00'] }],
          }),
        ),
      /tối đa 24 giờ/,
    );
    expect400(
      () =>
        parseFleetBody(
          voi({
            vehicles: [{ id: 'a', start: DEPOT, time_window: [T0, T1] }],
            jobs: [
              {
                id: 'd',
                location: HO_CON_RUA,
                time_windows: [['2026-09-26T09:00:00+07:00', '2026-09-26T10:00:00+07:00']],
              },
            ],
          }),
        ),
      /48 giờ/,
    );
    expect400(
      () =>
        parseFleetBody(
          voi({
            vehicles: [{ id: 'a', start: DEPOT, time_window: [T0, T1] }],
            jobs: [
              {
                id: 'd',
                location: HO_CON_RUA,
                time_windows: [
                  [T0, T1],
                  [T0, T1],
                  [T0, T1],
                  [T0, T1],
                ],
              },
            ],
          }),
        ),
      /time_windows tối đa 3/,
    );
  });
});

describe('fleetVroomBody', () => {
  it('id là chỉ số, [lng, lat], profile theo mode, end bỏ khi open, không capacity/delivery/time_window khi không dùng', () => {
    const body = fleetVroomBody(parseFleetBody(BODY));
    expect(body.vehicles).toEqual([
      {
        id: 0,
        profile: 'motor_scooter',
        start: [106.698, 10.7725],
        end: [106.698, 10.7725],
        max_tasks: 10,
      },
      { id: 1, profile: 'motor_scooter', start: [106.698, 10.7725], max_tasks: 10 },
    ]);
    expect(body.jobs[0]).toEqual({
      id: 0,
      location: [106.6958, 10.7826],
      service: 120,
      priority: 0,
    });
    expect(body.jobs[2]).toEqual({ id: 2, location: [106.6953, 10.777], service: 0, priority: 0 });
  });

  it('chế độ tuyệt đối: capacity [c], delivery [demand] cho MỌI đơn, time_window unix, priority, auto', () => {
    const body = fleetVroomBody(parseFleetBody(BODY_ABS));
    const t0 = Date.parse(T0) / 1000;
    const t1 = Date.parse(T1) / 1000;
    expect(body.vehicles[0]).toEqual({
      id: 0,
      profile: 'auto',
      start: [106.698, 10.7725],
      end: [106.698, 10.7725],
      capacity: [5],
      max_tasks: 10,
      time_window: [t0, t1],
    });
    expect(body.vehicles[1]?.max_tasks).toBe(2);
    expect(body.jobs[0]).toEqual({
      id: 0,
      location: [106.6958, 10.7826],
      service: 300,
      delivery: [3],
      priority: 50,
      time_windows: [
        [
          Date.parse('2026-09-24T09:00:00+07:00') / 1000,
          Date.parse('2026-09-24T10:00:00+07:00') / 1000,
        ],
      ],
    });
    expect(body.jobs[1]).toEqual({
      id: 1,
      location: [106.7069, 10.7686],
      service: 0,
      delivery: [2],
      priority: 0,
    });
  });
});

describe('fleetCacheUrl', () => {
  it('làm tròn 4 chữ số (11 m); khác mode/lang/đơn → khoá khác; dạng URL cache', async () => {
    const a = await fleetCacheUrl(parseFleetBody(BODY));
    const b = await fleetCacheUrl(
      parseFleetBody(
        voi({
          vehicles: [
            { id: 'xe-1', start: [10.77251, 106.69801] },
            { id: 'xe-2', start: DEPOT, end: 'open' },
          ],
        }),
      ),
    );
    const c = await fleetCacheUrl(parseFleetBody(voi({ mode: 'car' })));
    const d = await fleetCacheUrl(parseFleetBody(voi({ jobs: [BODY.jobs[0], BODY.jobs[1]] })));
    expect(a).toMatch(/^https:\/\/cache\.mapslibvn\/fleet-plan\?v=1&h=[0-9a-f]{64}$/);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(d).not.toBe(a);
  });
});

const route4 = routeFixture as unknown as ValhallaRouteResponse;
/** Tuyến 3 điểm / 2 leg cho xe open-end 2 đơn: cắt leg và điểm cuối khỏi fixture 4 điểm. */
const route3: ValhallaRouteResponse = {
  trip: {
    ...route4.trip,
    legs: route4.trip.legs.slice(0, 2),
    locations: route4.trip.locations.slice(0, 3),
  },
};
const vroom = vroomFixture as unknown as VroomResponse;

describe('translateFleet — chế độ tương đối', () => {
  it('xe-1: đơn theo thứ tự ghé, arrival_s từ lúc xuất phát, finish_s tới end; xe-2 rỗi; đơn 3 unassigned', () => {
    const p = parseFleetBody(BODY);
    const skel = translateFleet(vroom, p);
    expect(skel.vehicles).toHaveLength(2);
    expect(skel.vehicles[0]).toEqual({
      index: 0,
      jobIndexes: [1, 0],
      stops: [
        { job: 'don-2', arrival_s: 300, waiting_s: 0, service_s: 120 },
        { job: 'don-1', arrival_s: 700, waiting_s: 0, service_s: 120 },
      ],
      departureUnix: 0,
      finishS: 1000,
      load: 0,
    });
    expect(skel.vehicles[1]).toEqual({
      index: 1,
      jobIndexes: [],
      stops: [],
      departureUnix: 0,
      finishS: 0,
      load: 0,
    });
    expect(skel.unassigned).toEqual([2]);
    expect(skel.serviceS).toBe(240);
    expect(skel.waitingS).toBe(0);
  });

  it('không đoán khi dữ liệu lệch: vehicle lạ, đơn lạ, đơn gán hai lần, tổng đơn không khớp, step lạ → 503', () => {
    const p = parseFleetBody(BODY);
    const loi503 = (json: VroomResponse) => {
      try {
        translateFleet(json, p);
        throw new Error('phải ném');
      } catch (error) {
        expect((error as ApiError).status).toBe(503);
      }
    };
    const route = vroom.routes?.[0];
    if (!route) throw new Error('fixture thiếu route');
    loi503({ ...vroom, routes: [{ ...route, vehicle: 5 }] });
    loi503({
      ...vroom,
      routes: [
        { ...route, steps: route.steps.map((s) => (s.type === 'job' ? { ...s, id: 9 } : s)) },
      ],
    });
    loi503({
      ...vroom,
      routes: [
        { ...route, steps: route.steps.map((s) => (s.type === 'job' ? { ...s, id: 0 } : s)) },
      ],
    });
    loi503({ ...vroom, unassigned: [] }); // 2 đơn gán + 0 unassigned ≠ 3
    loi503({ ...vroom, unassigned: [{ id: 0 }, { id: 2 }] }); // đơn 0 vừa gán vừa unassigned
    loi503({
      ...vroom,
      routes: [{ ...route, steps: [{ type: 'pickup', arrival: 0, duration: 0 }] }],
    });
    loi503({ code: 0, unassigned: [] }); // thiếu routes
  });
});

describe('translateFleet — chế độ tuyệt đối', () => {
  const T_DEP = Date.parse('2026-09-24T08:12:00+07:00') / 1000;
  const absVroom: VroomResponse = {
    code: 0,
    summary: { cost: 1, routes: 1, unassigned: 0, service: 300, duration: 1380, waiting_time: 240 },
    unassigned: [],
    routes: [
      {
        vehicle: 0,
        cost: 1,
        service: 300,
        duration: 1380,
        waiting_time: 240,
        steps: [
          { type: 'start', arrival: T_DEP, duration: 0 },
          { type: 'job', id: 1, arrival: T_DEP + 540, duration: 540, service: 0, waiting_time: 0 },
          {
            type: 'job',
            id: 0,
            arrival: T_DEP + 1620,
            duration: 1380,
            service: 300,
            waiting_time: 240,
          },
          { type: 'end', arrival: T_DEP + 2700, duration: 1380 },
        ],
      },
    ],
  };

  it('departure do VROOM chọn; arrival_at theo múi +07:00; load = tổng demand; xe-2 rỗi departure = đầu ca', () => {
    const p = parseFleetBody(BODY_ABS);
    const skel = translateFleet(absVroom, p);
    expect(skel.vehicles[0]?.departureUnix).toBe(T_DEP);
    expect(skel.vehicles[0]?.stops).toEqual([
      {
        job: 'don-2',
        arrival_s: 540,
        arrival_at: '2026-09-24T08:21:00+07:00',
        waiting_s: 0,
        service_s: 0,
      },
      {
        job: 'don-1',
        arrival_s: 1620,
        arrival_at: '2026-09-24T08:39:00+07:00',
        waiting_s: 240,
        service_s: 300,
      },
    ]);
    expect(skel.vehicles[0]?.finishS).toBe(2700);
    expect(skel.vehicles[0]?.load).toBe(5);
    expect(skel.vehicles[1]?.departureUnix).toBe(Date.parse('2026-09-24T08:00:00+07:00') / 1000);
  });

  it('open-end không có step end: finish = đơn cuối + chờ + dừng', () => {
    const p = parseFleetBody(BODY_ABS);
    const route = absVroom.routes?.[0];
    if (!route) throw new Error('thiếu route');
    const openVroom: VroomResponse = {
      ...absVroom,
      routes: [{ ...route, vehicle: 1, steps: route.steps.slice(0, 3) }],
    };
    const skel = translateFleet(openVroom, p);
    expect(skel.vehicles[1]?.finishS).toBe(1620 + 240 + 300);
    expect(skel.vehicles[0]?.jobIndexes).toEqual([]);
  });
});

describe('fleetRouteBody', () => {
  it('start, đơn theo thứ tự ghé, end (bỏ khi open-end); costing và ngôn ngữ theo params', () => {
    const p = parseFleetBody({ ...BODY, lang: 'en' });
    const skel = translateFleet(vroom, p);
    const xe1 = skel.vehicles[0];
    if (!xe1) throw new Error('thiếu xe');
    expect(fleetRouteBody(p, xe1, 'req-1')).toEqual({
      locations: [
        { lat: 10.7725, lon: 106.698, type: 'break' },
        { lat: 10.7686, lon: 106.7069, type: 'break' },
        { lat: 10.7826, lon: 106.6958, type: 'break' },
        { lat: 10.7725, lon: 106.698, type: 'break' },
      ],
      costing: 'motor_scooter',
      directions_options: { language: 'en-US', units: 'kilometers' },
      id: 'req-1',
    });
    const open = fleetRouteBody(p, { ...xe1, index: 1 }, 'req-2');
    expect(open.locations).toHaveLength(3);
  });
});

describe('assembleFleetPlan', () => {
  it('xe có đơn = DirectionsResponse + vehicle/jobs/stops; xe rỗi có mặt với routes rỗng; summary; unassigned theo id', () => {
    const p = parseFleetBody(BODY);
    const skel = translateFleet(vroom, p);
    const plan = assembleFleetPlan(p, skel, [route4, null], '2026-09-17');
    expect(plan.mode).toBe('motorbike');
    expect(plan.vehicles).toHaveLength(2);
    const xe1 = plan.vehicles[0];
    expect(xe1?.vehicle).toBe('xe-1');
    expect(xe1?.jobs).toEqual(['don-2', 'don-1']);
    expect(xe1?.routes).toHaveLength(1);
    expect(xe1?.routes[0]?.legs).toHaveLength(3);
    expect(xe1?.waypoints).toHaveLength(4);
    expect(xe1?.stops).toHaveLength(2);
    expect(xe1?.finish_s).toBe(1000);
    expect(xe1?.load).toBe(0);
    expect(xe1).not.toHaveProperty('departure_at');
    expect(xe1?.attribution).toBe('© OpenStreetMap contributors');
    expect(plan.vehicles[1]).toMatchObject({
      vehicle: 'xe-2',
      jobs: [],
      stops: [],
      routes: [],
      waypoints: [],
      load: 0,
      finish_s: 0,
    });
    expect(plan.unassigned).toEqual([{ id: 'don-3' }]);
    expect(plan.summary).toEqual({
      vehicles_used: 1,
      jobs_assigned: 2,
      jobs_unassigned: 1,
      distance_m: xe1?.routes[0]?.distance_m,
      duration_s: xe1?.routes[0]?.duration_s,
      service_s: 240,
      waiting_s: 0,
    });
    expect(plan.engine).toEqual({ name: 'vroom+valhalla', graph: '2026-09-17' });
  });

  it('chế độ tuyệt đối: departure_at/finish_at theo múi giờ của xe; open-end dùng tuyến 2 leg', () => {
    const p = parseFleetBody(BODY_ABS);
    const T_DEP = Date.parse('2026-09-24T08:12:00+07:00') / 1000;
    const skel = translateFleet(
      {
        code: 0,
        summary: {
          cost: 1,
          routes: 1,
          unassigned: 0,
          service: 300,
          duration: 900,
          waiting_time: 0,
        },
        unassigned: [],
        routes: [
          {
            vehicle: 1,
            cost: 1,
            service: 300,
            duration: 900,
            waiting_time: 0,
            steps: [
              { type: 'start', arrival: T_DEP, duration: 0 },
              { type: 'job', id: 1, arrival: T_DEP + 400, duration: 400, service: 0 },
              { type: 'job', id: 0, arrival: T_DEP + 900, duration: 900, service: 300 },
            ],
          },
        ],
      },
      p,
    );
    const plan = assembleFleetPlan(p, skel, [null, route3], null);
    const xe2 = plan.vehicles[1];
    expect(xe2?.departure_at).toBe('2026-09-24T08:12:00+07:00');
    expect(xe2?.finish_at).toBe('2026-09-24T08:32:00+07:00');
    expect(xe2?.routes[0]?.legs).toHaveLength(2);
    expect(xe2?.waypoints).toHaveLength(3);
    expect(plan.summary.vehicles_used).toBe(1);
    expect(plan.vehicles[0]?.departure_at).toBe('2026-09-24T08:00:00+07:00');
  });

  it('thiếu tuyến cho xe có đơn hoặc số leg lệch số đơn → 503', () => {
    const p = parseFleetBody(BODY);
    const skel = translateFleet(vroom, p);
    const cases: (ValhallaRouteResponse | null)[][] = [
      [null, null],
      [route3, null],
    ];
    for (const routes of cases) {
      try {
        assembleFleetPlan(p, skel, routes, null);
        throw new Error('phải ném');
      } catch (error) {
        expect((error as ApiError).status).toBe(503);
      }
    }
  });
});

describe('noRouteMessage', () => {
  it('đối chiếu [lon, lat] trong thông điệp VROOM với đơn/xe đã gửi; không khớp → câu chung', () => {
    const ten = noRouteMessage(parseFleetBody(BODY));
    // Định dạng thật của VROOM 1.15: 6 chữ số thập phân (đo 23/09/2026).
    expect(ten('Unfound route(s) from location [106.706900,10.768600]')).toBe(
      'Không tới được bằng mạng đường: đơn don-2',
    );
    expect(
      ten('Unfound route(s) from location [106.7069,10.7686] to location [106.6958, 10.7826]'),
    ).toBe('Không tới được bằng mạng đường: đơn don-2, đơn don-1');
    expect(ten('Unfound route(s) from location [106.698,10.7725] to location [1,2]')).toBe(
      'Không tới được bằng mạng đường: xe xe-1 (điểm xuất phát)',
    );
    expect(ten('Unfound route(s)')).toBe('Có điểm không tới được bằng mạng đường');
  });
});

describe('fixture VROOM thật Quận 1 (capture 23/09/2026)', () => {
  it('5 đơn chia cho 2 xe, không unassigned, mỗi xe ≤ 3 đơn, arrival_s tăng dần', () => {
    const p = parseFleetBody(q1Request);
    const skel = translateFleet(q1Vroom as unknown as VroomResponse, p);
    expect(skel.unassigned).toEqual([]);
    const tong = skel.vehicles.reduce((sum, v) => sum + v.jobIndexes.length, 0);
    expect(tong).toBe(5);
    for (const v of skel.vehicles) {
      expect(v.jobIndexes.length).toBeGreaterThan(0);
      expect(v.jobIndexes.length).toBeLessThanOrEqual(3);
      const arrivals = v.stops.map((st) => st.arrival_s);
      expect([...arrivals].sort((a, b) => a - b)).toEqual(arrivals);
      expect(v.finishS).toBeGreaterThanOrEqual(arrivals.at(-1) ?? 0);
    }
  });
});
