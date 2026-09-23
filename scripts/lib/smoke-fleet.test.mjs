import { describe, expect, it } from 'vitest';
import { fleetBodyFor, fleetIssues, parseFleetSmokeArgs, planBaiFleet } from './smoke-fleet.mjs';
import { HCM_POINTS } from './smoke-matrix.mjs';

describe('planBaiFleet', () => {
  it('E: 5 xe cùng kho Chợ Bến Thành, 28 đơn là 28 điểm còn lại; E2: 2 xe, 8 đơn, sức chứa/khung giờ/dừng', () => {
    const { E, E2 } = planBaiFleet();
    expect(E.vehicles).toBe(5);
    expect(E.jobs).toHaveLength(28);
    expect(E.depot).toEqual(HCM_POINTS[1]);
    expect(E.jobs).not.toContainEqual(HCM_POINTS[1]);
    expect(E2.vehicles).toBe(2);
    expect(E2.jobs).toHaveLength(8);
    expect(E2.capacity).toBe(5);
    expect(E2.serviceS).toBe(300);
    expect(E2.windowJobs).toEqual([0, 3]);
  });
});

describe('fleetBodyFor', () => {
  it('E: không ràng buộc, kho dịch 0,0001° × k; E2: capacity, demand 1, service_s, ca 08:00–12:00, hai đơn có khung giờ', () => {
    const { E, E2 } = planBaiFleet();
    const e = fleetBodyFor(E, 2, '2026-09-24');
    expect(e.vehicles).toHaveLength(5);
    expect(e.vehicles[0]).toEqual({ id: 'xe-1', start: [10.7727, 106.698] });
    expect(e.jobs).toHaveLength(28);
    expect(e.jobs[0]).toEqual({ id: 'don-1', location: HCM_POINTS[0] });
    const e2 = fleetBodyFor(E2, 0, '2026-09-24');
    expect(e2.vehicles[0]).toEqual({
      id: 'xe-1',
      start: HCM_POINTS[1],
      capacity: 5,
      time_window: ['2026-09-24T08:00:00+07:00', '2026-09-24T12:00:00+07:00'],
    });
    expect(e2.jobs[0]).toMatchObject({
      demand: 1,
      service_s: 300,
      time_windows: [['2026-09-24T09:00:00+07:00', '2026-09-24T11:00:00+07:00']],
    });
    expect(e2.jobs[1]).not.toHaveProperty('time_windows');
  });
});

describe('fleetIssues', () => {
  const ok = {
    vehicles: [
      {
        vehicle: 'xe-1',
        jobs: ['don-1', 'don-2'],
        stops: [
          { job: 'don-1', arrival_s: 100 },
          { job: 'don-2', arrival_s: 300 },
        ],
        load: 2,
        routes: [{ legs: [{}, {}, {}] }],
        waypoints: [{}, {}, {}, {}],
      },
      { vehicle: 'xe-2', jobs: [], stops: [], load: 0, routes: [], waypoints: [] },
    ],
    unassigned: [],
    summary: { vehicles_used: 1, jobs_assigned: 2, jobs_unassigned: 0 },
  };
  const bai = { vehicles: 2, jobs: 2, capacity: null, roundTrip: true };
  const xe1 = ok.vehicles[0];
  const xe2 = ok.vehicles[1];

  it('hợp lệ → []', () => {
    expect(fleetIssues(ok, bai)).toEqual([]);
  });

  it('bắt: thiếu xe, tổng đơn lệch, leg lệch, arrival không tăng, load vượt sức chứa', () => {
    expect(fleetIssues({ ...ok, vehicles: [xe1] }, bai)).toContain('vehicles = 1, cần 2');
    expect(fleetIssues(ok, { ...bai, jobs: 3 })).toContain('đơn xếp + unassigned = 2, cần 3');
    const legLech = { ...ok, vehicles: [{ ...xe1, routes: [{ legs: [{}, {}] }] }, xe2] };
    expect(fleetIssues(legLech, bai)).toContain('xe-1: legs = 2, cần 3');
    const nguoc = {
      ...ok,
      vehicles: [
        {
          ...xe1,
          stops: [
            { job: 'don-1', arrival_s: 300 },
            { job: 'don-2', arrival_s: 100 },
          ],
        },
        xe2,
      ],
    };
    expect(fleetIssues(nguoc, bai)).toContain('xe-1: arrival_s không tăng dần');
    expect(fleetIssues(ok, { ...bai, capacity: 1 })).toContain('xe-1: load 2 vượt sức chứa 1');
    expect(fleetIssues(null, bai)).toEqual(['body không phải object']);
  });
});

describe('parseFleetSmokeArgs', () => {
  it('mặc định: production, 5 lượt cách 30 s, không ngưỡng, 0 vòng F, ratio 2, busy 2000; bỏ qua "--"', () => {
    expect(parseFleetSmokeArgs(['--', '--confirm-production'])).toEqual({
      base: 'https://api.ai-solutions.io.vn',
      confirmProduction: true,
      requests: 5,
      intervalMs: 30_000,
      p95Max: null,
      p95MaxE2: null,
      rounds: 0,
      ratioMax: 2,
      busyMax: 2000,
    });
    const r = parseFleetSmokeArgs([
      '--requests=3',
      '--rounds=2',
      '--p95-max=8000',
      '--p95-max-e2=5000',
    ]);
    expect(r).toMatchObject({ requests: 3, rounds: 2, p95Max: 8000, p95MaxE2: 5000 });
    expect(() => parseFleetSmokeArgs(['--la'])).toThrow(/Cờ không hợp lệ/);
    expect(() => parseFleetSmokeArgs(['--requests=31'])).toThrow(/--requests/);
  });
});
