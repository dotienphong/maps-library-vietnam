import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const base = process.env.ROUTING_API_BASE ?? 'http://127.0.0.1:8798';
const key = process.env.ROUTING_API_KEY ?? 'mlv_live_routingtest0000000000000';
/** @type {{ vehicles: Record<string, unknown>[], jobs: Record<string, unknown>[], mode: string }} */
const request = JSON.parse(
  readFileSync(new URL('../test/fixtures/vroom/q1-fleet-request.json', import.meta.url), 'utf8'),
);
/** @param {unknown} body */
const post = (body) =>
  fetch(`${base}/v1/fleet-plan`, {
    method: 'POST',
    headers: { 'X-Api-Key': key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const VI = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
const HOM_NAY = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

/** @typedef {{ vehicle: string, jobs: string[], stops: { job: string, arrival_at?: string, service_s: number }[], routes: { legs: { steps: { instruction: string }[] }[] }[], waypoints: { location: number[] }[], departure_at?: string, finish_at?: string }} Xe */

describe('/v1/fleet-plan trên Valhalla + VROOM fixture Quận 1', () => {
  it('5 đơn chia hết cho 2 xe (max_jobs 3): hoán vị đủ, mỗi xe là DirectionsResponse có câu tiếng Việt', async () => {
    const response = await post(request);
    expect(response.status).toBe(200);
    const plan = await response.json();
    expect(plan.vehicles).toHaveLength(2);
    expect(plan.unassigned).toEqual([]);
    /** @type {Xe[]} */
    const vehicles = plan.vehicles;
    const jobs = vehicles.flatMap((v) => v.jobs);
    expect([...jobs].sort()).toEqual(['don-1', 'don-2', 'don-3', 'don-4', 'don-5']);
    for (const v of vehicles) {
      expect(v.jobs.length).toBeGreaterThan(0);
      expect(v.jobs.length).toBeLessThanOrEqual(3);
      expect(v.routes[0]?.legs).toHaveLength(v.jobs.length + 1); // + leg về kho
      expect(v.waypoints).toHaveLength(v.jobs.length + 2);
      expect(v.stops.map((s) => s.job)).toEqual(v.jobs);
      expect(v.waypoints[0]?.location).toEqual([106.698, 10.7725]);
      const steps = (v.routes[0]?.legs ?? []).flatMap((leg) => leg.steps);
      expect(steps.some((s) => VI.test(s.instruction))).toBe(true);
      expect(v).not.toHaveProperty('departure_at');
    }
    expect(plan.summary.vehicles_used).toBe(2);
    expect(plan.summary.jobs_assigned).toBe(5);
    expect(plan.engine.name).toBe('vroom+valhalla');
  });

  it('open-end một xe: số leg = số đơn, waypoint cuối là đơn cuối', async () => {
    const response = await post({
      ...request,
      vehicles: [{ id: 'xe-1', start: [10.7725, 106.698], end: 'open' }],
    });
    expect(response.status).toBe(200);
    const plan = await response.json();
    const xe = plan.vehicles[0];
    expect(xe.jobs).toHaveLength(5);
    expect(xe.routes[0].legs).toHaveLength(5);
    expect(xe.waypoints).toHaveLength(6);
  });

  it('một đơn ngoài graph (Vũng Tàu) → 404 no_route gọi tên đơn', async () => {
    const response = await post({
      ...request,
      jobs: [...request.jobs.slice(0, 2), { id: 'vt', location: [10.346, 107.0843] }],
    });
    expect(response.status).toBe(404);
    const err = (await response.json()).error;
    expect(err.code).toBe('no_route');
    expect(err.message).toMatch(/đơn vt/);
  });

  it('chế độ tuyệt đối: departure_at trong ca, arrival_at tăng dần cùng múi +07:00', async () => {
    const tw = [`${HOM_NAY}T08:00:00+07:00`, `${HOM_NAY}T12:00:00+07:00`];
    const response = await post({
      ...request,
      vehicles: request.vehicles.map((v) => ({ ...v, time_window: tw })),
      jobs: request.jobs.map((j) => ({ ...j, service_s: 300 })),
    });
    expect(response.status).toBe(200);
    const plan = await response.json();
    /** @type {Xe[]} */
    const vehicles = plan.vehicles;
    for (const v of vehicles) {
      const dep = v.departure_at ?? '';
      expect(dep >= (tw[0] ?? '') && dep <= (tw[1] ?? '')).toBe(true);
      expect(v.finish_at?.endsWith('+07:00')).toBe(true);
      const arrivals = v.stops.map((s) => s.arrival_at ?? '');
      expect([...arrivals].sort()).toEqual(arrivals);
      for (const s of v.stops) expect(s.service_s).toBe(300);
    }
  });
});
